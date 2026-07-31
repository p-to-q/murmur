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
export const RECORDING_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface CachedRecording {
  blob: Blob;
  mimeType: string;
  savedAt: number;
  operationId: string | null;
  /** True when `blob` is the exact byte sequence sent to `/api/transcribe`. */
  uploadReady: boolean;
}

interface StoredRecord {
  blob: Blob;
  mimeType: string;
  savedAt: number;
  operationId?: string;
  uploadReady?: boolean;
}

type StoredRecordRead =
  { ok: true; value: unknown } | { ok: false; value?: never };

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
export async function saveRecordingBlob(
  blob: Blob,
  operationId?: string,
  options: { uploadReady?: boolean } = {},
): Promise<boolean> {
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
        operationId,
        uploadReady: options.uploadReady === true,
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
    const stored = await readRecording(db);
    if (!stored.ok || stored.value === undefined) return null;
    const recording = parseCachedRecording(stored.value);
    if (!recording || isRecordingExpired(recording.savedAt)) {
      await deleteRecording(db);
      return null;
    }
    return recording;
  } finally {
    db.close();
  }
}

/**
 * Drop the cached recording once its upload has been committed. Never rejects;
 * the return value makes an unavailable or failed browser store observable to
 * callers that need cleanup evidence.
 */
export async function clearRecordingBlob(): Promise<boolean> {
  const db = await openDatabase();
  if (!db) return false;
  try {
    return await deleteRecording(db);
  } finally {
    db.close();
  }
}

/**
 * Best-effort startup/visit sweep. Expired, legacy, or malformed entries are
 * removed the next time the app can access this store; no background deletion
 * is implied while the browser is closed.
 */
export async function sweepExpiredRecordingBlob(
  now = Date.now(),
): Promise<boolean> {
  const db = await openDatabase();
  if (!db) return false;
  try {
    const stored = await readRecording(db);
    if (!stored.ok) return false;
    if (stored.value === undefined) return true;
    const recording = parseCachedRecording(stored.value);
    if (!recording || isRecordingExpired(recording.savedAt, now)) {
      return await deleteRecording(db);
    }
    return true;
  } finally {
    db.close();
  }
}

export function isRecordingExpired(savedAt: number, now = Date.now()): boolean {
  return (
    !Number.isFinite(savedAt) ||
    savedAt <= 0 ||
    savedAt <= now - RECORDING_CACHE_TTL_MS
  );
}

function parseCachedRecording(value: unknown): CachedRecording | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<StoredRecord>;
  if (!(record.blob instanceof Blob)) return null;
  return {
    blob: record.blob,
    mimeType:
      typeof record.mimeType === "string" && record.mimeType
        ? record.mimeType
        : record.blob.type || "application/octet-stream",
    savedAt: typeof record.savedAt === "number" ? record.savedAt : 0,
    operationId:
      typeof record.operationId === "string" ? record.operationId : null,
    // Legacy entries stored the raw capture and must still pass through the
    // deterministic preparation step before retrying with their operation id.
    uploadReady: record.uploadReady === true,
  };
}

function readRecording(db: IDBDatabase): Promise<StoredRecordRead> {
  return new Promise((resolve) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE_NAME, "readonly");
    } catch {
      resolve({ ok: false });
      return;
    }
    try {
      const request = tx.objectStore(STORE_NAME).get(RECORD_KEY);
      request.onsuccess = () => resolve({ ok: true, value: request.result });
      request.onerror = () => resolve({ ok: false });
    } catch {
      resolve({ ok: false });
    }
  });
}

function deleteRecording(db: IDBDatabase): Promise<boolean> {
  return new Promise((resolve) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE_NAME, "readwrite");
    } catch {
      resolve(false);
      return;
    }
    try {
      tx.objectStore(STORE_NAME).delete(RECORD_KEY);
    } catch {
      resolve(false);
      return;
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}
