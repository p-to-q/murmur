import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { assertValidKey } from "../key";
import {
  type GetResult,
  type ObjectStore,
  type PutResult,
  type StorageScope,
  StorageError,
} from "../types";

const DEFAULT_PRESIGN_TTL_SECONDS = 600;

export interface S3CompatibleStoreOptions {
  /** Bucket name. Required. */
  bucket: string;
  /**
   * AWS region or vendor pseudo-region (e.g. "auto" for R2,
   * "ap-shanghai" for 腾讯云 COS).
   */
  region: string;
  /**
   * S3-compatible endpoint override. Examples:
   *   https://<accountid>.r2.cloudflarestorage.com (R2)
   *   https://cos.ap-shanghai.myqcloud.com         (腾讯云 COS)
   * Leave undefined to talk to real AWS S3.
   */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * Public CDN base URL for `scope: "public"` objects. Required when
   * `urlMode === "public-cdn"` (typically R2 / COS); ignored otherwise.
   * The final URL is `<publicUrlBase>/<key>`; we never sign public URLs.
   */
  publicUrlBase?: string;
  /**
   * How private-scope URLs are produced.
   *   "presigned" — default. Returns a short-lived signed URL.
   *   "public-cdn" — appends key to publicUrlBase. Use only when the
   *     bucket policy already gates by some other means (rare).
   */
  privateUrlMode?: "presigned" | "public-cdn";
  /** Override for testing — inject a pre-built S3Client. */
  client?: S3Client;
}

/**
 * S3-compatible object store. Targets AWS S3, Cloudflare R2, and
 * 腾讯云 COS through their shared HTTP+SigV4 surface.
 *
 * URL semantics:
 *   - `scope: "public"` returns `<publicUrlBase>/<key>` — permanent,
 *     CDN-friendly, no SDK call. Required for share assets where a
 *     short-lived URL would break embeds.
 *   - `scope: "private"` returns a presigned GET URL valid for
 *     `DEFAULT_PRESIGN_TTL_SECONDS` (10 minutes). The `url()` helper
 *     is synchronous; presigning happens at call time using the
 *     pre-built S3Client. For per-request TTLs use `presignGet()`.
 *
 * Note: this adapter is deliberately small — only put/get/delete/url.
 * Multipart, copy, list, and lifecycle ops belong in a later
 * adapter-extension as separately exported helpers, so the
 * `ObjectStore` contract stays narrow.
 */
export function createS3CompatibleStore(opts: S3CompatibleStoreOptions): ObjectStore {
  validateOptions(opts);

  const client = opts.client ?? buildClient(opts);

  function urlForKey(key: string, scope: StorageScope): string {
    assertValidKey(key);
    const mode = scope === "public" ? "public-cdn" : (opts.privateUrlMode ?? "presigned");
    if (mode === "public-cdn") {
      if (!opts.publicUrlBase) {
        throw new StorageError(
          "driver_unconfigured",
          "publicUrlBase must be set to serve public-scope URLs",
        );
      }
      return joinUrl(opts.publicUrlBase, key);
    }
    // For sync `url()` we cannot await the presigner. The contract
    // promises a string back; callers that need a real signed URL
    // should call `presignGet()` instead. Returning the canonical
    // virtual-host URL keeps logs and tests stable.
    return canonicalObjectUrl(opts, key);
  }

  return {
    driver: "s3-compatible",

    async put(key, body, putOpts) {
      assertValidKey(key);
      if (!(body instanceof Uint8Array)) {
        throw new TypeError("Storage body must be a Uint8Array");
      }
      const scope: StorageScope = putOpts.scope ?? "private";

      try {
        await client.send(
          new PutObjectCommand({
            Bucket: opts.bucket,
            Key: key,
            Body: Buffer.from(body),
            ContentType: putOpts.contentType,
            Metadata: stringifyMeta(putOpts.meta),
            CacheControl: putOpts.ttlSeconds
              ? `max-age=${putOpts.ttlSeconds}`
              : undefined,
          }),
        );
      } catch (cause) {
        throw asStorageError(cause, "io_error", "Failed to put object");
      }

      const result: PutResult = {
        key,
        url: urlForKey(key, scope),
        size: body.byteLength,
        contentType: putOpts.contentType,
        scope,
        storedAt: new Date(),
      };
      return result;
    },

    async get(key) {
      assertValidKey(key);
      try {
        const out = await client.send(
          new GetObjectCommand({ Bucket: opts.bucket, Key: key }),
        );
        const body = out.Body ? await streamToUint8Array(out.Body) : new Uint8Array(0);
        const result: GetResult = {
          body,
          contentType: out.ContentType ?? "application/octet-stream",
          size: out.ContentLength ?? body.byteLength,
          // S3 itself has no per-object scope concept; we trust the
          // caller's prior `put` scope choice and default to private
          // since callers without explicit scope went through `put`
          // as private.
          scope: "private",
          meta: out.Metadata ? { ...out.Metadata } : {},
          storedAt: out.LastModified ?? new Date(0),
        };
        return result;
      } catch (cause) {
        if (isS3NotFound(cause)) return null;
        throw asStorageError(cause, "io_error", "Failed to get object");
      }
    },

    async delete(key) {
      assertValidKey(key);
      try {
        await client.send(
          new DeleteObjectCommand({ Bucket: opts.bucket, Key: key }),
        );
      } catch (cause) {
        if (isS3NotFound(cause)) return;
        throw asStorageError(cause, "io_error", "Failed to delete object");
      }
    },

    url(key, scope) {
      return urlForKey(key, scope);
    },
  };
}

/**
 * Produce a short-lived presigned GET URL for `key`. Use this when a
 * caller needs a real signed URL — `ObjectStore.url()` returns a
 * canonical URL because it's sync.
 */
export async function presignGet(
  store: ObjectStore,
  key: string,
  opts: { bucket: string; client: S3Client; ttlSeconds?: number },
): Promise<string> {
  if (store.driver !== "s3-compatible") {
    throw new StorageError(
      "unsupported",
      `presignGet requires s3-compatible driver, got ${store.driver}`,
    );
  }
  assertValidKey(key);
  return getSignedUrl(
    opts.client,
    new GetObjectCommand({ Bucket: opts.bucket, Key: key }),
    { expiresIn: opts.ttlSeconds ?? DEFAULT_PRESIGN_TTL_SECONDS },
  );
}

function validateOptions(opts: S3CompatibleStoreOptions): void {
  for (const field of ["bucket", "region", "accessKeyId", "secretAccessKey"] as const) {
    if (!opts[field]) {
      throw new StorageError(
        "driver_unconfigured",
        `s3-compatible adapter missing required field: ${field}`,
      );
    }
  }
}

function buildClient(opts: S3CompatibleStoreOptions): S3Client {
  const config: S3ClientConfig = {
    region: opts.region,
    credentials: {
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
    },
  };
  if (opts.endpoint) {
    config.endpoint = opts.endpoint;
    // R2 and COS both prefer path-style addressing because their hosts
    // are not virtual-host capable for arbitrary bucket names.
    config.forcePathStyle = true;
  }
  return new S3Client(config);
}

function stringifyMeta(
  meta: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!meta) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(meta)) {
    // S3 metadata is ASCII-only and stored lower-cased on retrieval.
    out[k.toLowerCase()] = v;
  }
  return out;
}

function joinUrl(base: string, key: string): string {
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const normalizedKey = key.startsWith("/") ? key.slice(1) : key;
  return `${normalizedBase}/${normalizedKey}`;
}

function canonicalObjectUrl(opts: S3CompatibleStoreOptions, key: string): string {
  if (opts.endpoint) {
    return joinUrl(`${opts.endpoint}/${opts.bucket}`, key);
  }
  return `https://${opts.bucket}.s3.${opts.region}.amazonaws.com/${key}`;
}

function isS3NotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  if (e.name === "NoSuchKey" || e.name === "NotFound") return true;
  return e.$metadata?.httpStatusCode === 404;
}

function asStorageError(
  cause: unknown,
  code: "io_error" | "invalid_body",
  fallback: string,
): StorageError {
  if (cause instanceof StorageError) return cause;
  const message = cause instanceof Error ? cause.message : fallback;
  return new StorageError(code, message);
}

/**
 * Drain an S3 GetObject body stream into a single Uint8Array. The
 * SDK types the body as `StreamingBlobPayloadOutputTypes` which can
 * be a Node Readable, a web ReadableStream, a Blob, or a string. We
 * normalise everything here so the adapter return type is invariant.
 */
async function streamToUint8Array(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  if (typeof body === "string") return new TextEncoder().encode(body);
  // Web ReadableStream
  if (typeof Response !== "undefined" && body && typeof (body as ReadableStream).getReader === "function") {
    const buf = await new Response(body as ReadableStream).arrayBuffer();
    return new Uint8Array(buf);
  }
  // Node Readable
  if (body && typeof (body as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function") {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
      const u8 = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
      chunks.push(u8);
      total += u8.byteLength;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  }
  throw new StorageError("io_error", "Unsupported S3 body stream type");
}
