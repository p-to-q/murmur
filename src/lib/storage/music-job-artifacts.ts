import { createHash } from "node:crypto";

import { getObjectStore, objectKey } from "@/lib/storage";

export async function storeMusicJobHum(input: {
  userId: string;
  operationId: string;
  bytes: Uint8Array;
  contentType: string;
}): Promise<{ key: string; digest: string }> {
  const digest = createHash("sha256").update(input.bytes).digest("hex");
  const artifactId = createHash("sha256")
    .update(`${input.operationId}:${digest}`)
    .digest("hex")
    .slice(0, 32);
  const key = objectKey({
    kind: "tmp",
    userId: input.userId,
    id: `hum_${artifactId}`,
    ext: extensionForAudio(input.contentType),
  });
  const store = getObjectStore();
  if (!(await store.get(key))) {
    await store.put(key, input.bytes, {
      contentType: input.contentType,
      scope: "private",
      ttlSeconds: 24 * 60 * 60,
      meta: {
        operationId: input.operationId,
        digest,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
      },
    });
  }
  return { key, digest };
}

export async function storeMusicJobOutput(input: {
  userId: string;
  jobId: string;
  bytes: Uint8Array;
  contentType: string;
}) {
  const digest = createHash("sha256").update(input.bytes).digest("hex");
  const key = objectKey({
    kind: "music-job-audio",
    userId: input.userId,
    id: digest,
    ext: extensionForAudio(input.contentType),
  });
  const store = getObjectStore();
  const existing = await store.get(key);
  const result = existing
    ? { key, size: existing.size, contentType: existing.contentType }
    : await store.put(key, input.bytes, {
        contentType: input.contentType,
        scope: "private",
        meta: { jobId: input.jobId, digest },
      });
  return { storageKey: result.key, sizeBytes: result.size, contentType: result.contentType, digest };
}

function extensionForAudio(contentType: string): string {
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("mpeg") || contentType.includes("mp3")) return "mp3";
  if (contentType.includes("ogg")) return "ogg";
  return "wav";
}
