import { getObjectStore, objectKey, StorageError } from "@/lib/storage";
import { createHash } from "node:crypto";
import { detectAudioFileType } from "@/lib/audio/file-signature";

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
    const compactPayload = payload.replace(/\s+/g, "");
    if (
      isBase64
      && (
        compactPayload.length % 4 !== 0
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compactPayload)
      )
    ) {
      return null;
    }
    const bytes = isBase64
      ? new Uint8Array(Buffer.from(compactPayload, "base64"))
      : new TextEncoder().encode(decodeURIComponent(payload));
    if (bytes.byteLength === 0) return null;
    const detectedType = detectAudioFileType(bytes);
    if (!detectedType || detectedType !== ext) return null;
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
  created: boolean;
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
  const privateDelivery = privateSongAudioDeliveryEnabled();
  const existing = await store.get(key);
  const existingDigest = existing
    ? createHash("sha256").update(existing.body).digest("hex")
    : null;
  if (existing && existingDigest === parsed.digest) {
    return {
      mp3Url: privateDelivery
        ? ownerSongAudioUrl(input.songId)
        : store.url(key, "public"),
      mp3StorageKey: key,
      contentType: existing.contentType,
      sizeBytes: existing.size,
      digest: parsed.digest,
      created: false,
    };
  }
  const result = await store.put(key, parsed.bytes, {
    scope: privateDelivery ? "private" : "public",
    contentType: parsed.contentType,
    meta: { songId: input.songId, digest: parsed.digest },
  });

  const verified = await store.get(key);
  const verifiedDigest = verified
    ? createHash("sha256").update(verified.body).digest("hex")
    : null;
  if (!verified || verifiedDigest !== parsed.digest) {
    await store.delete(key).catch(() => undefined);
    throw new StorageError(
      "io_error",
      "Song audio failed read-after-write verification",
    );
  }

  return {
    mp3Url: privateDelivery
      ? ownerSongAudioUrl(input.songId)
      : result.url,
    mp3StorageKey: result.key,
    contentType: verified.contentType,
    sizeBytes: verified.size,
    digest: parsed.digest,
    created: true,
  };
}

export function ownerSongAudioUrl(songId: string): string {
  return `/api/songs/${encodeURIComponent(songId)}/audio`;
}

export function publicSongAudioUrl(shareCode: string): string {
  return `/api/public/songs/${encodeURIComponent(shareCode)}/audio`;
}

/**
 * Private writes are an expand/contract cutover. Production defaults to the
 * legacy public object until a Web release containing the controlled read
 * routes has become the tested rollback baseline.
 */
export function privateSongAudioDeliveryEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const configured = env.MURMUR_PRIVATE_SONG_AUDIO_DELIVERY?.trim().toLowerCase();
  if (configured) return ["1", "true", "yes"].includes(configured);
  return env.NODE_ENV !== "production";
}
