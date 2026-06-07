import { promises as fs } from "node:fs";
import * as path from "node:path";

import { assertValidKey } from "../key";
import {
  type GetResult,
  type ObjectStore,
  type PutResult,
  type StorageScope,
  StorageError,
} from "../types";

interface SidecarMeta {
  contentType: string;
  scope: StorageScope;
  meta: Record<string, string>;
  storedAt: string;
  expiresAt: string | null;
}

export interface LocalFsStoreOptions {
  /**
   * Filesystem root for stored objects. Defaults to
   * `MURMUR_STORAGE_LOCAL_DIR` or `.murmur/storage` under the
   * process cwd. The directory is created lazily on first write.
   */
  root?: string;
  /**
   * Path prefix used when constructing URLs. Must match a server
   * route that proxies to this adapter — see
   * `src/app/api/storage/local/[...key]/route.ts`.
   */
  urlPrefix?: string;
}

/**
 * Filesystem-backed object store. Intended for local development,
 * single-host preview deployments, and quick "save a few samples to
 * disk and grep them" workflows. Not for production — there is no
 * replication, no atomicity across files, and no access auditing.
 *
 * Layout under `root/`:
 *   <key>            — the raw bytes
 *   <key>.meta.json  — sidecar with content-type, scope, ttl, meta
 *
 * The sidecar carries scope + ttl so `get()` can honor them without
 * touching the file payload. Sidecar reads/writes are best-effort —
 * a missing sidecar treats the object as `private`, `application/octet-stream`,
 * no expiry. That is the right failure for dev: keep serving the file.
 */
export function createLocalFsStore(opts: LocalFsStoreOptions = {}): ObjectStore {
  const root = path.resolve(
    opts.root ??
      process.env.MURMUR_STORAGE_LOCAL_DIR ??
      path.join(/* turbopackIgnore: true */ process.cwd(), ".murmur", "storage"),
  );
  const urlPrefix = opts.urlPrefix ?? "/api/storage/local";

  function fullPath(key: string): string {
    const resolved = path.resolve(root, key);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      // assertValidKey already rejects ".." and leading "/", but a
      // belt-and-braces check defends against any future key shape
      // we haven't anticipated.
      throw new StorageError(
        "invalid_key",
        `Key resolved outside storage root: ${JSON.stringify(key)}`,
      );
    }
    return resolved;
  }

  async function readSidecar(target: string): Promise<SidecarMeta | null> {
    try {
      const raw = await fs.readFile(`${target}.meta.json`, "utf8");
      return JSON.parse(raw) as SidecarMeta;
    } catch (cause) {
      if (isNotFound(cause)) return null;
      throw new StorageError(
        "io_error",
        `Failed to read sidecar: ${(cause as Error).message}`,
      );
    }
  }

  return {
    driver: "local-fs",

    async put(key, body, putOpts) {
      assertValidKey(key);
      if (!(body instanceof Uint8Array)) {
        throw new TypeError("Storage body must be a Uint8Array");
      }

      const target = fullPath(key);
      await fs.mkdir(path.dirname(target), { recursive: true });

      const now = new Date();
      const scope: StorageScope = putOpts.scope ?? "private";
      const expiresAt = putOpts.ttlSeconds
        ? new Date(now.getTime() + putOpts.ttlSeconds * 1000).toISOString()
        : null;

      try {
        await fs.writeFile(target, body);
      } catch (cause) {
        throw new StorageError(
          "io_error",
          `Failed to write object: ${(cause as Error).message}`,
        );
      }

      const sidecar: SidecarMeta = {
        contentType: putOpts.contentType,
        scope,
        meta: { ...(putOpts.meta ?? {}) },
        storedAt: now.toISOString(),
        expiresAt,
      };
      try {
        await fs.writeFile(`${target}.meta.json`, JSON.stringify(sidecar));
      } catch (cause) {
        throw new StorageError(
          "io_error",
          `Failed to write sidecar: ${(cause as Error).message}`,
        );
      }

      const result: PutResult = {
        key,
        url: buildUrl(urlPrefix, key),
        size: body.byteLength,
        contentType: putOpts.contentType,
        scope,
        storedAt: now,
      };
      return result;
    },

    async get(key) {
      assertValidKey(key);
      const target = fullPath(key);

      let body: Uint8Array;
      try {
        const buf = await fs.readFile(target);
        body = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      } catch (cause) {
        if (isNotFound(cause)) return null;
        throw new StorageError(
          "io_error",
          `Failed to read object: ${(cause as Error).message}`,
        );
      }

      const sidecar = await readSidecar(target);
      const contentType = sidecar?.contentType ?? "application/octet-stream";
      const scope: StorageScope = sidecar?.scope ?? "private";
      const storedAt = sidecar?.storedAt ? new Date(sidecar.storedAt) : new Date(0);
      const meta = sidecar?.meta ? { ...sidecar.meta } : {};

      if (sidecar?.expiresAt && new Date(sidecar.expiresAt).getTime() <= Date.now()) {
        // Lazy expiry — delete on read so the disk doesn't grow.
        await this.delete(key);
        return null;
      }

      const result: GetResult = {
        body,
        contentType,
        size: body.byteLength,
        scope,
        meta,
        storedAt,
      };
      return result;
    },

    async delete(key) {
      assertValidKey(key);
      const target = fullPath(key);
      await unlinkIfExists(target);
      await unlinkIfExists(`${target}.meta.json`);
    },

    url(key) {
      assertValidKey(key);
      return buildUrl(urlPrefix, key);
    },
  };
}

function buildUrl(prefix: string, key: string): string {
  const normalizedPrefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  return `${normalizedPrefix}/${key}`;
}

async function unlinkIfExists(target: string): Promise<void> {
  try {
    await fs.unlink(target);
  } catch (cause) {
    if (isNotFound(cause)) return;
    throw new StorageError(
      "io_error",
      `Failed to delete: ${(cause as Error).message}`,
    );
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
