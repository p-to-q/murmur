import { createHash } from "node:crypto";

import { createMusicJob } from "@/lib/db/queries/music-jobs";
import { hashMusicJobRequest } from "@/lib/music/music-job-contract";
import { getObjectStore } from "@/lib/storage";
import { storeMusicJobHum } from "@/lib/storage/music-job-artifacts";
import { shouldDeleteDuplicateHum } from "@/lib/storage/music-job-hum-lifecycle";

export async function createMusicJobReceipt(input: {
  userId: string;
  operationId: string;
  requestId: string;
  prompt: string;
  duration: number;
  styleMix: number;
  melody: string;
  hum: File | null;
  generationBatchId: string | null;
  bill: boolean;
}) {
  const humBytes = input.hum
    ? new Uint8Array(await input.hum.arrayBuffer())
    : null;
  const humDigest = humBytes
    ? createHash("sha256").update(humBytes).digest("hex")
    : null;
  const requestHash = hashMusicJobRequest({
    prompt: input.prompt,
    duration: input.duration,
    styleMix: input.styleMix,
    melody: input.melody,
    humDigest,
  });
  let storedHum: Awaited<ReturnType<typeof storeMusicJobHum>> | null = null;
  try {
    storedHum = humBytes
      ? await storeMusicJobHum({
          userId: input.userId,
          operationId: input.operationId,
          bytes: humBytes,
          contentType: input.hum?.type || "audio/webm",
        })
      : null;
    const created = await createMusicJob({
      userId: input.userId,
      operationId: input.operationId,
      requestHash,
      requestId: input.requestId,
      bill: input.bill,
      input: {
        originRequestId: input.requestId,
        prompt: input.prompt,
        duration: input.duration,
        styleMix: input.styleMix,
        melody: input.melody,
        humStorageKey: storedHum?.key ?? null,
        humDigest: storedHum?.digest ?? null,
        humContentType: input.hum?.type || null,
        generationBatchId: input.generationBatchId,
      },
    });
    if (!created.ok) {
      if (storedHum) await getObjectStore().delete(storedHum.key).catch(() => undefined);
      return created;
    }
    if (storedHum && shouldDeleteDuplicateHum({
      storedHumKey: storedHum.key,
      duplicate: created.duplicate,
      jobHumStorageKey: created.job.input.humStorageKey,
    })) {
      await getObjectStore().delete(storedHum.key).catch(() => undefined);
    }
    return created;
  } catch (error) {
    if (storedHum) await getObjectStore().delete(storedHum.key).catch(() => undefined);
    throw error;
  }
}
