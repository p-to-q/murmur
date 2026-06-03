/**
 * Object store contract for Murmur — the single abstraction across
 * which audio masters, posters, share-page HTML, and any future
 * blob asset flows.
 *
 * The interface is intentionally narrow: `put`, `get`, `delete`,
 * `url`. Anything richer (presigned uploads, multipart, copy-in-place)
 * is added through additional optional methods on a specific adapter
 * rather than being widened here, so the contract test stays cheap.
 *
 * Adapters live under `./adapters/`. Drivers map 1:1 to adapters and
 * are selected at process startup by `MURMUR_STORAGE_DRIVER`. See
 * `docs/research-2026-06.md` §7 for the cost / vendor analysis that
 * justifies the multi-backend shape.
 */

/**
 * Drivers known to Murmur. New backends extend this union; the
 * factory in `./index.ts` is the only switch site that needs to be
 * kept in sync.
 */
export type StorageDriver = "memory" | "local-fs" | "s3-compatible";

/**
 * Visibility intent for a stored object.
 *
 * - `public`: served without authentication; safe for share-page
 *   assets, posters embedded in social previews, etc.
 * - `private`: requires an authenticated request (or a presigned URL
 *   with a short TTL) to read. Default for anything user-owned.
 *
 * Adapters that have no native concept of scope (e.g. local-fs in
 * dev) still record the value on the metadata so a future audit can
 * tell what *should* have been gated.
 */
export type StorageScope = "public" | "private";

export interface PutOpts {
  /** MIME type used both for response headers and for sniff prevention. */
  contentType: string;
  /** Default `private` unless explicitly opted into `public`. */
  scope?: StorageScope;
  /** Optional expiry — adapters that support TTL will honor it; others ignore. */
  ttlSeconds?: number;
  /** Arbitrary opaque metadata; values must be ASCII-safe short strings. */
  meta?: Record<string, string>;
}

export interface PutResult {
  key: string;
  url: string;
  size: number;
  contentType: string;
  scope: StorageScope;
  storedAt: Date;
}

export interface GetResult {
  body: Uint8Array;
  contentType: string;
  size: number;
  scope: StorageScope;
  meta: Record<string, string>;
  storedAt: Date;
}

export type StorageErrorCode =
  | "not_found"
  | "invalid_key"
  | "invalid_body"
  | "unsupported"
  | "driver_unconfigured"
  | "io_error";

export class StorageError extends Error {
  readonly code: StorageErrorCode;

  constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}

export interface ObjectStore {
  readonly driver: StorageDriver;

  /** Write `body` under `key`. Overwrites any existing object at that key. */
  put(
    key: string,
    body: Uint8Array,
    opts: PutOpts,
  ): Promise<PutResult>;

  /** Read the object at `key`, or `null` if missing. */
  get(key: string): Promise<GetResult | null>;

  /** Delete the object at `key`. No-op if missing. */
  delete(key: string): Promise<void>;

  /**
   * Return the URL clients should use to fetch the object. For
   * private-scope objects the URL may require auth headers; for
   * adapters that issue presigned URLs the result is short-lived.
   */
  url(key: string, scope: StorageScope): string;
}
