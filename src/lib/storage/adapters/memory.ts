import { assertValidKey } from "../key";
import type {
  GetResult,
  ObjectStore,
  PutResult,
  StorageScope,
} from "../types";

interface MemoryRecord {
  body: Uint8Array;
  contentType: string;
  scope: StorageScope;
  meta: Record<string, string>;
  storedAt: Date;
  expiresAt: number | null;
}

/**
 * In-memory object store. Used by tests and as a safe default in
 * environments that haven't configured a real backend. Never persists
 * across process restarts.
 *
 * `url()` returns an `memory://` URI — clients can't fetch this, but
 * tests that only care about round-tripping see a stable identifier.
 */
export function createMemoryStore(): ObjectStore {
  const records = new Map<string, MemoryRecord>();

  function reapIfExpired(key: string, now: number): MemoryRecord | null {
    const record = records.get(key);
    if (!record) return null;
    if (record.expiresAt !== null && record.expiresAt <= now) {
      records.delete(key);
      return null;
    }
    return record;
  }

  return {
    driver: "memory",

    async put(key, body, opts) {
      assertValidKey(key);
      assertValidBody(body);
      const now = Date.now();
      const scope: StorageScope = opts.scope ?? "private";
      const record: MemoryRecord = {
        body: copyBytes(body),
        contentType: opts.contentType,
        scope,
        meta: { ...(opts.meta ?? {}) },
        storedAt: new Date(now),
        expiresAt: opts.ttlSeconds ? now + opts.ttlSeconds * 1000 : null,
      };
      records.set(key, record);
      const result: PutResult = {
        key,
        url: `memory://${key}`,
        size: record.body.byteLength,
        contentType: record.contentType,
        scope,
        storedAt: record.storedAt,
      };
      return result;
    },

    async get(key) {
      assertValidKey(key);
      const record = reapIfExpired(key, Date.now());
      if (!record) return null;
      const result: GetResult = {
        body: copyBytes(record.body),
        contentType: record.contentType,
        size: record.body.byteLength,
        scope: record.scope,
        meta: { ...record.meta },
        storedAt: record.storedAt,
      };
      return result;
    },

    async delete(key) {
      assertValidKey(key);
      records.delete(key);
    },

    url(key) {
      assertValidKey(key);
      return `memory://${key}`;
    },
  };
}

function assertValidBody(body: Uint8Array): void {
  if (!(body instanceof Uint8Array)) {
    throw new TypeError("Storage body must be a Uint8Array");
  }
}

function copyBytes(input: Uint8Array): Uint8Array {
  const copy = new Uint8Array(input.byteLength);
  copy.set(input);
  return copy;
}
