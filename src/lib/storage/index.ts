import { createLocalFsStore } from "./adapters/local-fs";
import { createMemoryStore } from "./adapters/memory";
import { StorageError, type ObjectStore, type StorageDriver } from "./types";

export { objectKey, assertValidKey, type ObjectKind } from "./key";
export {
  type GetResult,
  type ObjectStore,
  type PutOpts,
  type PutResult,
  type StorageDriver,
  type StorageScope,
  StorageError,
} from "./types";

let cached: ObjectStore | null = null;

/**
 * Resolve the process-wide object store. The driver is picked once
 * per process and cached; tests can override via
 * `__setObjectStoreForTesting` and reset via
 * `__resetObjectStoreForTesting`.
 *
 * Driver selection:
 * - `MURMUR_STORAGE_DRIVER` env wins if set.
 * - In test (`NODE_ENV=test`), default to `memory` so suites don't
 *   need filesystem access and don't pollute one another.
 * - Otherwise default to `local-fs` so dev "just works" without
 *   provisioning an S3 bucket.
 * - Production deployments must set `MURMUR_STORAGE_DRIVER=s3-compatible`
 *   (adapter to land in a follow-up PR) plus the bucket / endpoint
 *   env. Until then, production with no env raises `driver_unconfigured`.
 */
export function getObjectStore(): ObjectStore {
  if (cached) return cached;
  cached = buildObjectStore(resolveDriver());
  return cached;
}

function resolveDriver(): StorageDriver {
  const raw = process.env.MURMUR_STORAGE_DRIVER?.trim().toLowerCase();
  if (raw) {
    if (raw === "memory" || raw === "local-fs" || raw === "s3-compatible") {
      return raw;
    }
    throw new StorageError(
      "driver_unconfigured",
      `Unknown MURMUR_STORAGE_DRIVER value: ${JSON.stringify(raw)}`,
    );
  }
  if (process.env.NODE_ENV === "test") return "memory";
  if (process.env.NODE_ENV === "production") {
    throw new StorageError(
      "driver_unconfigured",
      "MURMUR_STORAGE_DRIVER must be set in production",
    );
  }
  return "local-fs";
}

function buildObjectStore(driver: StorageDriver): ObjectStore {
  switch (driver) {
    case "memory":
      return createMemoryStore();
    case "local-fs":
      return createLocalFsStore();
    case "s3-compatible":
      throw new StorageError(
        "driver_unconfigured",
        "s3-compatible adapter is not yet implemented; see follow-up PR",
      );
  }
}

/**
 * Test-only override. Set to `null` to fall back to env-driven
 * resolution on the next `getObjectStore()` call.
 */
export function __setObjectStoreForTesting(store: ObjectStore | null): void {
  cached = store;
}

/** Test-only — equivalent to `__setObjectStoreForTesting(null)`. */
export function __resetObjectStoreForTesting(): void {
  cached = null;
}
