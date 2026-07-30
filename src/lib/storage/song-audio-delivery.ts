import { createHash } from "node:crypto";

import {
  detectAudioFileType,
  MAX_SONG_AUDIO_BYTES,
  type SupportedAudioFileType,
} from "@/lib/audio/file-signature";
import { getObjectStore } from "@/lib/storage";
import { assertValidKey } from "@/lib/storage/key";
import {
  ownerSongAudioUrl,
  parseAudioDataUrl,
} from "@/lib/storage/song-audio";

export interface SongAudioReference {
  mp3StorageKey?: string | null;
  mp3DataUrl?: string | null;
  mp3Url?: string | null;
}

export type SongAudioArtifactResult =
  | { status: "ready"; artifact: SongAudioArtifact }
  | { status: "missing"; storageKey: string }
  | { status: "none" };

export interface SongAudioArtifact {
  body: Uint8Array;
  contentType: string;
  size: number;
  digest: string;
  source: "object" | "data_url" | "legacy_object_url";
}

export async function resolveSongAudioArtifact(
  song: SongAudioReference,
): Promise<SongAudioArtifactResult> {
  const storageKey = nonEmpty(song.mp3StorageKey);
  if (storageKey) return readStoredArtifact(storageKey, "object");

  const dataUrl = nonEmpty(song.mp3DataUrl);
  if (dataUrl) {
    const parsed = parseAudioDataUrl(dataUrl);
    if (!parsed) return { status: "none" };
    return {
      status: "ready",
      artifact: {
        body: parsed.bytes,
        contentType: parsed.contentType,
        size: parsed.bytes.byteLength,
        digest: parsed.digest,
        source: "data_url",
      },
    };
  }

  const recoveredKey = storageKeyFromLegacyUrl(song.mp3Url);
  return recoveredKey
    ? readStoredArtifact(recoveredKey, "legacy_object_url")
    : { status: "none" };
}

export async function songAudioArtifactIsAvailable(
  song: SongAudioReference,
): Promise<boolean> {
  const result = await resolveSongAudioArtifact(song);
  return result.status === "ready" || Boolean(legacyExternalSongAudioUrl(song.mp3Url));
}

export function hasSongAudioReference(song: SongAudioReference): boolean {
  return Boolean(
    nonEmpty(song.mp3StorageKey)
    || nonEmpty(song.mp3DataUrl)
    || storageKeyFromLegacyUrl(song.mp3Url),
  );
}

export function legacyExternalSongAudioUrl(value: unknown): string | null {
  const raw = nonEmpty(value);
  if (!raw || storageKeyFromLegacyUrl(raw)) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Keep storage coordinates server-owned. Clients receive one stable,
 * same-origin playback URL while legacy external URLs remain readable during
 * migration when no durable key or embedded artifact exists.
 */
export function serializeOwnerSong<
  T extends SongAudioReference & { id: string },
>(song: T) {
  const rest = { ...song } as Omit<T, keyof SongAudioReference>;
  const mp3Url = song.mp3Url;
  delete (rest as Partial<SongAudioReference>).mp3StorageKey;
  delete (rest as Partial<SongAudioReference>).mp3DataUrl;
  delete (rest as Partial<SongAudioReference>).mp3Url;
  const legacyUrl = legacyExternalSongAudioUrl(mp3Url);
  return {
    ...rest,
    audioUrl: hasSongAudioReference(song)
      ? ownerSongAudioUrl(song.id)
      : legacyUrl,
  };
}

export function buildSongAudioResponse(input: {
  request: Request;
  artifact: SongAudioArtifact;
  title: string;
  requestId: string;
  cacheControl: string;
}): Response {
  const { request, artifact } = input;
  const etag = `"sha256-${artifact.digest}"`;
  const isHead = request.method.toUpperCase() === "HEAD";
  const download = new URL(request.url).searchParams.get("download") === "1";
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": input.cacheControl,
    "Content-Type": artifact.contentType,
    "Content-Disposition": contentDisposition(input.title, artifact.contentType, download),
    "ETag": etag,
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": input.requestId,
  });

  if (ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }

  const range = !isHead && ifRangeAllowsRange(request.headers.get("if-range"), etag)
    ? parseByteRange(request.headers.get("range"), artifact.size)
    : null;
  if (range?.status === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${artifact.size}`);
    headers.set("Content-Length", "0");
    return new Response(null, { status: 416, headers });
  }
  if (range?.status === "partial") {
    const body = artifact.body.slice(range.start, range.end + 1);
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${artifact.size}`);
    headers.set("Content-Length", String(body.byteLength));
    return new Response(isHead ? null : streamBytes(body), { status: 206, headers });
  }

  headers.set("Content-Length", String(artifact.size));
  return new Response(isHead ? null : streamBytes(artifact.body), { status: 200, headers });
}

export function parseByteRange(
  header: string | null,
  size: number,
):
  | null
  | { status: "partial"; start: number; end: number }
  | { status: "unsatisfiable" } {
  if (!header) return null;
  const normalized = header.trim();
  if (!normalized.startsWith("bytes=") || normalized.includes(",")) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(normalized);
  if (!match) return null;
  if (size <= 0) return { status: "unsatisfiable" };
  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (!startText && !endText) return null;

  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return {
      status: "partial",
      start: Math.max(0, size - suffix),
      end: size - 1,
    };
  }

  const start = Number(startText);
  const requestedEnd = endText ? Number(endText) : size - 1;
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || requestedEnd < start
  ) {
    return null;
  }
  if (start >= size) return { status: "unsatisfiable" };
  return { status: "partial", start, end: Math.min(requestedEnd, size - 1) };
}

async function readStoredArtifact(
  storageKey: string,
  source: SongAudioArtifact["source"],
): Promise<SongAudioArtifactResult> {
  const stored = await getObjectStore().get(storageKey);
  if (!stored) return { status: "missing", storageKey };
  const detectedType = validStoredAudioType(stored);
  if (!detectedType) return { status: "missing", storageKey };
  return {
    status: "ready",
    artifact: {
      body: stored.body,
      contentType: canonicalContentType(detectedType),
      size: stored.body.byteLength,
      digest: createHash("sha256").update(stored.body).digest("hex"),
      source,
    },
  };
}

function validStoredAudioType(input: {
  body: Uint8Array;
  contentType: string;
  size: number;
}): SupportedAudioFileType | null {
  if (
    input.body.byteLength === 0
    || input.body.byteLength > MAX_SONG_AUDIO_BYTES
    || !Number.isSafeInteger(input.size)
    || input.size !== input.body.byteLength
  ) {
    return null;
  }
  const detectedType = detectAudioFileType(input.body);
  return detectedType && contentTypeMatches(input.contentType, detectedType)
    ? detectedType
    : null;
}

function contentTypeMatches(value: string, type: SupportedAudioFileType): boolean {
  const normalized = value.split(";", 1)[0]?.trim().toLowerCase();
  return type === "mp3"
    ? normalized === "audio/mpeg" || normalized === "audio/mp3"
    : normalized === "audio/wav" || normalized === "audio/x-wav" || normalized === "audio/wave";
}

function canonicalContentType(type: SupportedAudioFileType): string {
  return type === "mp3" ? "audio/mpeg" : "audio/wav";
}

function ifNoneMatchMatches(value: string | null, etag: string): boolean {
  if (!value) return false;
  return value.split(",").some((candidate) => {
    const normalized = candidate.trim();
    return normalized === "*" || normalized.replace(/^W\//, "") === etag;
  });
}

function ifRangeAllowsRange(value: string | null, etag: string): boolean {
  if (!value) return true;
  const normalized = value.trim();
  return normalized !== "" && !normalized.startsWith("W/") && normalized === etag;
}

function storageKeyFromLegacyUrl(value: unknown): string | null {
  const raw = nonEmpty(value);
  if (!raw) return null;
  const localPrefix = "/api/storage/local/";
  if (raw.startsWith(localPrefix)) return validKey(raw.slice(localPrefix.length));

  const publicBase = process.env.MURMUR_STORAGE_S3_PUBLIC_URL_BASE?.replace(/\/+$/, "");
  if (!publicBase || !raw.startsWith(`${publicBase}/`)) return null;
  return validKey(decodeURIComponent(raw.slice(publicBase.length + 1)));
}

function validKey(value: string): string | null {
  try {
    assertValidKey(value);
    return value;
  } catch {
    return null;
  }
}

function contentDisposition(title: string, contentType: string, download: boolean): string {
  const ext = contentType.includes("wav")
    ? "wav"
    : contentType.includes("ogg")
      ? "ogg"
      : "mp3";
  const normalized = title.trim() || "murmur-song";
  const fallback = normalized
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "murmur-song";
  return `${download ? "attachment" : "inline"}; filename="${fallback}.${ext}"; filename*=UTF-8''${encodeURIComponent(`${normalized}.${ext}`)}`;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function streamBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  const chunkSize = 64 * 1024;
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, bytes.byteLength);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
  });
}
