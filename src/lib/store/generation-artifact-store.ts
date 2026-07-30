"use client";

/**
 * Durable client-side store for completed generation clips (#300).
 *
 * A generated clip's playable audio lives in a browser blob URL that dies on
 * reload. Before #300, persisting a draft therefore dropped the audio and the
 * recovery path re-generated it — re-charging the note and re-sampling
 * different audio. Here we persist the actual clip BYTES to IndexedDB keyed by
 * the clip's stable `operationId`, so restoration rehydrates the exact audited
 * clip instead of re-purchasing it.
 *
 * Everything is best-effort and guarded: in SSR/tests/private-mode where
 * IndexedDB is unavailable, persist is a no-op and load returns null, so the
 * caller falls back to resuming the same paid operation.
 */

const DB_NAME = "murmur-generation";
const STORE_NAME = "clips";
const DB_VERSION = 1;
// Clips are cleared on flow reset; this TTL just bounds growth if a user keeps
// generating without ever saving/resetting.
export const ARTIFACT_TTL_MS = 24 * 60 * 60 * 1000;

interface StoredClip {
  operationId: string;
  bytes: ArrayBuffer;
  contentType: string;
  storedAt: number;
}

function isStoredClip(value: unknown): value is StoredClip {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<StoredClip>;
  return (
    typeof record.operationId === "string" &&
    record.operationId.length > 0 &&
    record.bytes instanceof ArrayBuffer &&
    typeof record.contentType === "string" &&
    typeof record.storedAt === "number"
  );
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, {
            keyPath: "operationId",
          });
          store.createIndex("storedAt", "storedAt");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  }).catch(() => null);
  return dbPromise;
}

function txStore(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

/** Persist a completed clip's bytes under its stable operation id. Best-effort. */
export async function persistClipArtifact(
  operationId: string,
  blob: Blob,
): Promise<void> {
  if (!operationId) return;
  const db = await openDb();
  if (!db) return;
  let bytes: ArrayBuffer;
  try {
    bytes = await blob.arrayBuffer();
  } catch {
    return;
  }
  const record: StoredClip = {
    operationId,
    bytes,
    contentType: blob.type || "audio/wav",
    storedAt: Date.now(),
  };
  await new Promise<void>((resolve) => {
    try {
      const store = txStore(db, "readwrite");
      store.put(record);
      store.transaction.oncomplete = () => resolve();
      store.transaction.onerror = () => resolve();
      store.transaction.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  // Opportunistic prune of anything past the TTL.
  void pruneExpired(db);
}

/** Load a previously persisted clip as a fresh Blob, or null if absent. */
export async function loadClipArtifact(
  operationId: string,
): Promise<Blob | null> {
  if (!operationId) return null;
  const db = await openDb();
  if (!db) return null;
  const record = await new Promise<StoredClip | null>((resolve) => {
    try {
      const request = txStore(db, "readonly").get(operationId);
      request.onsuccess = () => {
        const record = request.result;
        if (!isStoredClip(record)) {
          resolve(null);
          return;
        }
        resolve(record);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  if (!record) return null;
  if (isClipArtifactExpired(record.storedAt)) {
    await deleteClipArtifact(operationId);
    return null;
  }
  return new Blob([record.bytes], { type: record.contentType || "audio/wav" });
}

/** Remove a single clip (e.g. after it has been saved and no longer needs recovery). */
export async function deleteClipArtifact(
  operationId: string,
): Promise<boolean> {
  if (!operationId) return true;
  const db = await openDb();
  if (!db) return false;
  return await new Promise<boolean>((resolve) => {
    try {
      const store = txStore(db, "readwrite");
      store.delete(operationId);
      store.transaction.oncomplete = () => resolve(true);
      store.transaction.onerror = () => resolve(false);
      store.transaction.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/** Drop every persisted clip — called when a creation flow resets. */
export async function clearAllClipArtifacts(): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return await new Promise<boolean>((resolve) => {
    try {
      const store = txStore(db, "readwrite");
      store.clear();
      store.transaction.oncomplete = () => resolve(true);
      store.transaction.onerror = () => resolve(false);
      store.transaction.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Best-effort startup/visit sweep. Entries past their 24-hour recovery window
 * are removed the next time this browser store is available.
 */
export async function sweepExpiredClipArtifacts(
  now = Date.now(),
): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return await pruneExpired(db, now);
}

async function pruneExpired(
  db: IDBDatabase,
  now = Date.now(),
): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    try {
      const store = txStore(db, "readwrite");
      const transaction = store.transaction;
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const record = cursor.value;
        if (
          !isStoredClip(record) ||
          isClipArtifactExpired(record.storedAt, now)
        ) {
          cursor.delete();
        }
        cursor.continue();
      };
      request.onerror = () => resolve(false);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
      transaction.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export function isClipArtifactExpired(
  storedAt: number,
  now = Date.now(),
): boolean {
  return (
    !Number.isFinite(storedAt) ||
    storedAt <= 0 ||
    storedAt <= now - ARTIFACT_TTL_MS
  );
}
