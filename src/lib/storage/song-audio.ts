import { getObjectStore, objectKey } from "@/lib/storage";
import { createHash } from "node:crypto";

/**
 * Server-side helper that moves a freshly rendered song master from the
 * base64 data URL the browser produces into the object-storage adapter
 * (#292). Callers persist the returned `mp3Url` + `mp3StorageKey` instead
 * of embedding megabytes of base64 in Postgres.
 *
 * The legacy `mp3DataUrl` column stays a read-only fallback for old rows;
 * nothing here writes it.
 */

const AUDIO_MIME_TO_EXT: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
};

export interface ParsedAudioDataUrl {
  contentType: string;
  ext: string;
  bytes: Uint8Array;
  digest: string;
}

/**
 * Parse a `data:audio/…;base64,…` (or percent-encoded) URL into its MIME
 * type, canonical extension, and raw bytes. Returns null for anything that
 * is not a recognised audio data URL so callers can fall back cleanly.
 */
export function parseAudioDataUrl(dataUrl: string): ParsedAudioDataUrl | null {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return null;
  const match = /^data:([^;,]+)((?:;[^,]*)*),([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  const contentType = match[1]!.trim().toLowerCase();
  const ext = AUDIO_MIME_TO_EXT[contentType];
  if (!ext) return null;
  const isBase64 = /;base64/i.test(match[2] ?? "");
  const payload = match[3] ?? "";
  try {
    const bytes = isBase64
      ? new Uint8Array(Buffer.from(payload, "base64"))
      : new TextEncoder().encode(decodeURIComponent(payload));
    if (bytes.byteLength === 0) return null;
    const digest = createHash("sha256").update(bytes).digest("hex");
    return { contentType, ext, bytes, digest };
  } catch {
    return null;
  }
}

export interface UploadedSongAudio {
  mp3Url: string;
  mp3StorageKey: string;
  contentType: string;
  sizeBytes: number;
  digest: string;
}

export async function storedSongAudioDigest(
  storageKey: string | null | undefined,
): Promise<string | null> {
  if (!storageKey) return null;
  const stored = await getObjectStore().get(storageKey);
  return stored ? createHash("sha256").update(stored.body).digest("hex") : null;
}

/**
 * Upload a rendered master to object storage under a deterministic,
 * content-addressed song key. Exact retries reuse the existing object while
 * different audio for the same song id cannot overwrite an earlier master.
 *
 * Returns null when the data URL is not decodable audio (the caller treats
 * that as "no audio"). Storage/adapter failures throw and are handled by the
 * caller's demo-safe fallback.
 */
export async function uploadSongMasterFromDataUrl(input: {
  userId: string;
  songId: string;
  dataUrl: string;
}): Promise<UploadedSongAudio | null> {
  const parsed = parseAudioDataUrl(input.dataUrl);
  if (!parsed) return null;

  const key = objectKey({
    kind: "song-master",
    userId: input.userId,
    songId: input.songId,
    id: parsed.digest,
    ext: parsed.ext,
  });

  const store = getObjectStore();
  const existing = await store.get(key);
  if (existing) {
    return {
      mp3Url: store.url(key, "public"),
      mp3StorageKey: key,
      contentType: existing.contentType,
      sizeBytes: existing.size,
      digest: parsed.digest,
    };
  }
  const result = await store.put(key, parsed.bytes, {
    // Song masters are fetched directly by the browser <audio> element and by
    // the public share page, so they need a stable URL. Presigned private URLs
    // would expire out from under a persisted row; public scope yields a
    // durable, storable URL (the key itself is the unguessable capability).
    scope: "public",
    contentType: parsed.contentType,
    meta: { songId: input.songId },
  });

  return {
    mp3Url: result.url,
    mp3StorageKey: result.key,
    contentType: result.contentType,
    sizeBytes: result.size,
    digest: parsed.digest,
  };
}
