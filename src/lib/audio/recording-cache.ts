/**
 * Last-recording cache — a tiny IndexedDB-backed store that keeps the most
 * recent hum recording on the device across the upload round-trip.
 *
 * Why (issue #234): `HumScreen` assembles the recorded audio into an in-memory
 * Blob and uploads it immediately. A network drop mid-upload throws away the
 * only copy and forces the user to re-hum (and risks a spent note with nothing
 * to show for it). Persisting the assembled Blob here — right before upload —
 * lets the error card offer a "retry last recording" affordance that resubmits
 * the exact same take.
 *
 * Design notes:
 *   - Native IndexedDB only; no dependency. Blobs are stored directly via
 *     structured clone (supported by every IndexedDB engine we target).
 *   - Single-slot: we only ever care about the *last* recording, keyed by a
 *     constant. A new take overwrites the previous one.
 *   - Graceful degradation: Safari private mode historically throws on `open`,
 *     and quota pressure throws on write. Every operation is wrapped so a
 *     failure resolves to a safe no-op (`false` / `null`) and the caller
 *     behaves exactly as it would with no cache at all.
 */

const DB_NAME = "murmur-recordings";
const DB_VERSION = 1;
const STORE_NAME = "last-recording";
const RECORD_KEY = "current";

export interface CachedRecording {
  blob: Blob;
  mimeType: string;
  savedAt: number;
}

interface StoredRecord {
  blob: Blob;
  mimeType: string;
  savedAt: number;
}

/**
 * Resolve the IndexedDB factory, tolerating environments where the global is
 * absent (SSR) or throws on access (sandboxed iframes, disabled storage).
 */
function indexedDbFactory(): IDBFactory | null {
  try {
    if (typeof indexedDB !== "undefined" && indexedDB) return indexedDB;
  } catch {
    // Accessing `indexedDB` itself can throw under strict storage policies.
  }
  return null;
}

function openDatabase(): Promise<IDBDatabase | null> {
  const factory = indexedDbFactory();
  if (!factory) return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DB_NAME, DB_VERSION);
    } catch {
      // Safari private mode can throw synchronously here.
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

/**
 * Persist the assembled recording as the single "last recording" slot,
 * overwriting any previous take. Resolves `true` only when the write commits;
 * any storage failure resolves `false` so callers can skip the recovery
 * affordance rather than surface a broken retry.
 */
export async function saveRecordingBlob(blob: Blob): Promise<boolean> {
  const db = await openDatabase();
  if (!db) return false;
  try {
    return await new Promise<boolean>((resolve) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE_NAME, "readwrite");
      } catch {
        resolve(false);
        return;
      }
      const record: StoredRecord = {
        blob,
        mimeType: blob.type || "application/octet-stream",
        savedAt: Date.now(),
      };
      try {
        tx.objectStore(STORE_NAME).put(record, RECORD_KEY);
      } catch {
        resolve(false);
        return;
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  } finally {
    db.close();
  }
}

/**
 * Read back the last persisted recording, or `null` when none is stored or
 * storage is unavailable. Validates the shape so a corrupt/legacy record never
 * hands the caller a non-Blob.
 */
export async function loadRecordingBlob(): Promise<CachedRecording | null> {
  const db = await openDatabase();
  if (!db) return null;
  try {
    return await new Promise<CachedRecording | null>((resolve) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE_NAME, "readonly");
      } catch {
        resolve(null);
        return;
      }
      let req: IDBRequest<unknown>;
      try {
        req = tx.objectStore(STORE_NAME).get(RECORD_KEY);
      } catch {
        resolve(null);
        return;
      }
      req.onsuccess = () => {
        const value = req.result as Partial<StoredRecord> | undefined;
        if (!value || !(value.blob instanceof Blob)) {
          resolve(null);
          return;
        }
        resolve({
          blob: value.blob,
          mimeType:
            value.mimeType || value.blob.type || "application/octet-stream",
          savedAt: typeof value.savedAt === "number" ? value.savedAt : 0,
        });
      };
      req.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

/**
 * Drop the cached recording once its upload has been committed. Never rejects —
 * a failed delete just leaves a stale blob that the next successful save
 * overwrites.
 */
export async function clearRecordingBlob(): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE_NAME, "readwrite");
      } catch {
        resolve();
        return;
      }
      try {
        tx.objectStore(STORE_NAME).delete(RECORD_KEY);
      } catch {
        resolve();
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}
