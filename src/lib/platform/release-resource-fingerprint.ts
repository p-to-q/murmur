import { createHash } from "node:crypto";
import { databaseResourceIdFromDsn } from "@/lib/db/resource-identity";

export const RELEASE_RESOURCE_FINGERPRINT_KEYS = [
  "MURMUR_DATABASE_RESOURCE_ID",
  "MURMUR_STORAGE_RESOURCE_ID",
  "MURMUR_STORAGE_DRIVER",
  "MURMUR_STORAGE_S3_BUCKET",
  "MURMUR_STORAGE_S3_REGION",
  "MURMUR_STORAGE_S3_ENDPOINT",
  "MURMUR_AUDIO_WORKER_RESOURCE_ID",
  "MURMUR_MUSIC_WORKER_RESOURCE_ID",
  "AUDIO_WORKER_URL",
  "RUNPOD_SERVERLESS_ENDPOINT_ID",
  "MUSIC_ENGINE_MODE",
  "MURMUR_MUSIC_RELEASE_SHA",
  "MURMUR_MUSIC_QUALITY_EVIDENCE_REQUIRED",
  "MURMUR_MUSIC_V2_EVIDENCE_REQUIRED",
] as const;

type ReleaseResourceEnvironment = Readonly<Record<string, string | undefined>>;

/** Hashes the bounded, non-secret identity of resources used by one release. */
export function releaseResourceFingerprint(
  environment: ReleaseResourceEnvironment = process.env as ReleaseResourceEnvironment,
): string {
  const runtimeDatabaseResourceId = databaseResourceIdFromDsn(
    environment.DATABASE_URL?.trim() || environment.POSTGRES_URL?.trim() || "",
  );
  const identity = RELEASE_RESOURCE_FINGERPRINT_KEYS.map((key) => [
    key,
    key === "MURMUR_DATABASE_RESOURCE_ID" && runtimeDatabaseResourceId
      ? runtimeDatabaseResourceId
      : environment[key]?.trim() ?? "",
  ]);

  return createHash("sha256")
    .update(JSON.stringify({ version: 1, identity }))
    .digest("hex");
}
