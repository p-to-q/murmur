import { getObjectStore, objectKey } from "@/lib/storage";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface MiniMaxMusicGenerateInput {
  lyrics: string;
  prompt: string;
  title?: string;
  userId: string;
  songId: string;
  requestId?: string;
}

export interface MiniMaxMusicGenerateResult {
  mp3Url: string;
  audioObjectKey: string;
  providerModel: string;
  contentType: string;
  durationSec: number | null;
  bytes: number;
}

export class MiniMaxMusicError extends Error {
  readonly code:
    | "provider_unconfigured"
    | "provider_http_error"
    | "provider_invalid_response"
    | "provider_generation_failed"
    | "audio_download_failed"
    | "storage_failed";
  readonly status: number;
  readonly detail?: unknown;

  constructor(
    code: MiniMaxMusicError["code"],
    message: string,
    status = 500,
    detail?: unknown,
  ) {
    super(message);
    this.name = "MiniMaxMusicError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

const DEFAULT_MODEL = "music-2.6";
const DEFAULT_ENDPOINT = "https://api.minimax.io/v1/music_generation";
const MAX_LYRICS_CHARS = 3500;
const MAX_PROMPT_CHARS = 2000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

export async function generateMiniMaxMusic(
  input: MiniMaxMusicGenerateInput,
): Promise<MiniMaxMusicGenerateResult> {
  if (process.env.MINIMAX_MUSIC_MOCK === "1") {
    return generateMockMiniMaxMusic(input);
  }

  const apiKey = process.env.MINIMAX_API_KEY?.trim();
  if (!apiKey) {
    throw new MiniMaxMusicError(
      "provider_unconfigured",
      "MINIMAX_API_KEY is not configured",
      503,
    );
  }

  const model = process.env.MINIMAX_MUSIC_MODEL?.trim() || DEFAULT_MODEL;
  const endpoint = process.env.MINIMAX_MUSIC_API_URL?.trim() || DEFAULT_ENDPOINT;
  const lyrics = input.lyrics.trim();
  const prompt = input.prompt.trim();

  if (!lyrics || lyrics.length > MAX_LYRICS_CHARS) {
    throw new MiniMaxMusicError(
      "provider_invalid_response",
      "lyrics must be between 1 and 3500 characters",
      400,
    );
  }
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
    throw new MiniMaxMusicError(
      "provider_invalid_response",
      "prompt must be between 1 and 2000 characters",
      400,
    );
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const groupId = process.env.MINIMAX_GROUP_ID?.trim();
  if (groupId) headers["GroupId"] = groupId;
  if (input.requestId) headers["X-Request-Id"] = input.requestId;

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      lyrics,
      prompt,
      title: input.title?.trim() || undefined,
      output_format: "url",
    }),
    signal: AbortSignal.timeout(295_000),
  }).catch((error) => {
    throw new MiniMaxMusicError(
      "provider_http_error",
      error instanceof Error ? error.message : "MiniMax request failed",
      502,
    );
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new MiniMaxMusicError(
      "provider_http_error",
      `MiniMax returned HTTP ${response.status}`,
      502,
      summarizeMiniMaxPayload(payload),
    );
  }

  assertMiniMaxSuccess(payload);
  const audio = extractMiniMaxAudio(payload);
  if (!audio) {
    throw new MiniMaxMusicError(
      "provider_invalid_response",
      "MiniMax returned no audio URL or hex payload",
      502,
      summarizeMiniMaxPayload(payload),
    );
  }

  const downloaded =
    audio.kind === "url"
      ? await downloadAudio(audio.url)
      : hexToAudio(audio.hex);

  const store = getObjectStore();
  const contentType = downloaded.contentType || "audio/mpeg";
  const ext = contentType.includes("wav") ? "wav" : "mp3";
  const key = objectKey({
    kind: "song-master",
    userId: input.userId,
    songId: input.songId,
    id: crypto.randomUUID(),
    ext,
  });

  try {
    const stored = await store.put(key, downloaded.body, {
      contentType,
      scope: "public",
      meta: {
        provider: "minimax",
        model,
      },
    });
    return {
      mp3Url: stored.url,
      audioObjectKey: stored.key,
      providerModel: `minimax:${model}`,
      contentType: stored.contentType,
      durationSec: extractDuration(payload),
      bytes: stored.size,
    };
  } catch (error) {
    throw new MiniMaxMusicError(
      "storage_failed",
      error instanceof Error ? error.message : "Could not store MiniMax audio",
      500,
    );
  }
}

async function generateMockMiniMaxMusic(
  input: MiniMaxMusicGenerateInput,
): Promise<MiniMaxMusicGenerateResult> {
  const store = getObjectStore();
  const demoPath = resolve(process.cwd(), "public/demo/weightless-dnb.mp3");
  const body = new Uint8Array(await readFile(demoPath));
  const key = objectKey({
    kind: "song-master",
    userId: input.userId,
    songId: input.songId,
    id: crypto.randomUUID(),
    ext: "mp3",
  });
  const stored = await store.put(key, body, {
    contentType: "audio/mpeg",
    scope: "public",
    meta: {
      provider: "minimax",
      model: process.env.MINIMAX_MUSIC_MODEL?.trim() || DEFAULT_MODEL,
      mock: "1",
    },
  });
  return {
    mp3Url: stored.url,
    audioObjectKey: stored.key,
    providerModel: `minimax:${process.env.MINIMAX_MUSIC_MODEL?.trim() || DEFAULT_MODEL}`,
    contentType: stored.contentType,
    durationSec: null,
    bytes: stored.size,
  };
}

function assertMiniMaxSuccess(payload: unknown): void {
  if (!payload || typeof payload !== "object") {
    throw new MiniMaxMusicError(
      "provider_invalid_response",
        "MiniMax returned a non-object payload",
        502,
        summarizeMiniMaxPayload(payload),
      );
  }

  const record = payload as Record<string, unknown>;
  const base = record.base_resp;
  if (base && typeof base === "object") {
    const statusCode = (base as Record<string, unknown>).status_code;
    if (statusCode !== undefined && statusCode !== 0) {
      throw new MiniMaxMusicError(
        "provider_generation_failed",
        "MiniMax generation failed",
        502,
        summarizeMiniMaxPayload(payload),
      );
    }
  }

  const status = record.status ?? nested(record, ["data", "status"]);
  if (status !== undefined && Number(status) !== 2) {
    throw new MiniMaxMusicError(
      "provider_generation_failed",
      "MiniMax generation did not complete",
      502,
      summarizeMiniMaxPayload(payload),
    );
  }
}

function extractMiniMaxAudio(
  payload: unknown,
): { kind: "url"; url: string } | { kind: "hex"; hex: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const candidates = [
    record.audio_url,
    record.audio,
    nested(record, ["data", "audio_url"]),
    nested(record, ["data", "audio"]),
    nested(record, ["data", "audio_file"]),
    nested(record, ["data", "output", "audio_url"]),
    nested(record, ["data", "output", "audio"]),
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.length === 0) continue;
    if (/^https?:\/\//i.test(candidate)) return { kind: "url", url: candidate };
    if (/^[0-9a-fA-F]+$/.test(candidate) && candidate.length > 32) {
      return { kind: "hex", hex: candidate };
    }
  }
  return null;
}

async function downloadAudio(url: string): Promise<{
  body: Uint8Array;
  contentType: string;
}> {
  assertAllowedAudioUrl(url);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  }).catch((error) => {
    throw new MiniMaxMusicError(
      "audio_download_failed",
      error instanceof Error ? error.message : "Could not download MiniMax audio",
      502,
    );
  });

  if (!response.ok) {
    throw new MiniMaxMusicError(
      "audio_download_failed",
      `MiniMax audio URL returned HTTP ${response.status}`,
      502,
    );
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_AUDIO_BYTES) {
    throw new MiniMaxMusicError(
      "audio_download_failed",
      "MiniMax audio is larger than Murmur's download limit",
      502,
      { contentLength, maxBytes: MAX_AUDIO_BYTES },
    );
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_AUDIO_BYTES) {
    throw new MiniMaxMusicError(
      "audio_download_failed",
      "MiniMax audio is larger than Murmur's download limit",
      502,
      { bytes: buffer.byteLength, maxBytes: MAX_AUDIO_BYTES },
    );
  }
  return {
    body: new Uint8Array(buffer),
    contentType: response.headers.get("content-type") || "audio/mpeg",
  };
}

function assertAllowedAudioUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new MiniMaxMusicError(
      "audio_download_failed",
      "MiniMax returned an invalid audio URL",
      502,
    );
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new MiniMaxMusicError(
      "audio_download_failed",
      "MiniMax returned an unsupported audio URL protocol",
      502,
    );
  }

  const host = parsed.hostname.toLowerCase();
  const allowed = allowedAudioHosts();
  if (!allowed.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))) {
    throw new MiniMaxMusicError(
      "audio_download_failed",
      "MiniMax audio URL host is not allowed",
      502,
      { host },
    );
  }
}

function allowedAudioHosts(): string[] {
  const configured = process.env.MINIMAX_AUDIO_HOST_ALLOWLIST
    ?.split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean) ?? [];
  const endpointHost = hostnameFromUrl(process.env.MINIMAX_MUSIC_API_URL);
  return [
    "minimax.io",
    "minimaxi.chat",
    "minimax.chat",
    ...(endpointHost ? [endpointHost] : []),
    ...configured,
  ];
}

function hostnameFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function summarizeMiniMaxPayload(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const base = record.base_resp;
  const baseRecord = base && typeof base === "object" ? base as Record<string, unknown> : null;
  return {
    status: record.status ?? nested(record, ["data", "status"]) ?? null,
    baseStatusCode: baseRecord?.status_code ?? null,
    baseStatusMsg: typeof baseRecord?.status_msg === "string"
      ? baseRecord.status_msg.slice(0, 160)
      : null,
    hasAudio: extractMiniMaxAudio(payload) !== null,
  };
}

function hexToAudio(hex: string): { body: Uint8Array; contentType: string } {
  const body = Buffer.from(hex, "hex");
  return {
    body: new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
    contentType: "audio/mpeg",
  };
}

function extractDuration(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const raw =
    record.duration ??
    record.duration_sec ??
    nested(record, ["data", "duration"]) ??
    nested(record, ["data", "duration_sec"]);
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function nested(record: Record<string, unknown>, path: string[]): unknown {
  let cursor: unknown = record;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}
