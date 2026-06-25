export type SpeechLanguage = "zh" | "en" | "unknown";

export interface SpeechSegment {
  text: string;
  start?: number;
  end?: number;
  confidence?: number;
  avgLogprob?: number;
  noSpeechProb?: number;
  compressionRatio?: number;
}

export interface SpeechTranscription {
  text: string;
  language: SpeechLanguage;
  confidence: number;
  segments?: SpeechSegment[];
  provider: string;
  vad?: SpeechVadDiagnostics;
  audio?: SpeechAudioDiagnostics;
  asrDiagnostics?: SpeechAsrDiagnostics;
}

export interface SpeechRecognitionProvider {
  transcribeSpeech(audio: File, options?: { requestId?: string }): Promise<SpeechTranscription>;
}

export type VoiceRouteDecision =
  | {
      kind: "hum";
      confidence: number;
      diagnostics: VoiceRouteDiagnostics;
    }
  | {
      kind: "voice";
      lyrics: string;
      language: SpeechLanguage;
      confidence: number;
      diagnostics: VoiceRouteDiagnostics;
    };

export interface VoiceRouteDiagnostics {
  provider: string;
  textLength: number;
  tokenCount: number;
  lexicalTokenCount: number;
  lyricTokenRatio: number;
  repeatedSyllableRatio: number;
  language: SpeechLanguage;
  asrConfidence: number;
  reason: string;
  vad?: SpeechVadDiagnostics;
  audio?: SpeechAudioDiagnostics;
  asr?: SpeechAsrDiagnostics;
}

const MAX_LYRIC_CHARS = 3500;
const DEFAULT_SPEECH_WORKER_TIMEOUT_MS = 8_000;
const MIN_VAD_SPEECH_MS = 900;
const MIN_VAD_SPEECH_RATIO = 0.18;
const MAX_VAD_FRAGMENTATION_PER_10S = 6;
const MIN_SNR_DB = 6;
const MAX_CLIPPING_RATIO = 0.02;

const HUM_SYLLABLES = new Set([
  "ah",
  "a",
  "la",
  "lala",
  "na",
  "nana",
  "da",
  "dum",
  "hmm",
  "hum",
  "mmm",
  "oh",
  "ooh",
  "woo",
  "wu",
  "ya",
]);

export class SpeechRecognitionError extends Error {
  readonly code:
    | "provider_unconfigured"
    | "provider_http_error"
    | "provider_invalid_response";
  readonly status: number;

  constructor(
    code: SpeechRecognitionError["code"],
    message: string,
    status = 500,
  ) {
    super(message);
    this.name = "SpeechRecognitionError";
    this.code = code;
    this.status = status;
  }
}

export function getSpeechRecognitionProvider(): SpeechRecognitionProvider | null {
  if (process.env.MURMUR_VOICE_INPUT_ENABLED !== "1") return null;
  const workerUrl = process.env.SPEECH_WORKER_URL?.trim();
  if (!workerUrl) return null;
  return new SpeechWorkerRecognitionProvider(workerUrl);
}

export function classifySpeechTranscription(
  transcription: SpeechTranscription,
): VoiceRouteDecision {
  const text = normalizeLyrics(transcription.text);
  const tokens = lyricTokens(text);
  const lexicalTokens = tokens.filter((token) => !HUM_SYLLABLES.has(token.toLowerCase()));
  const repeatedSyllableRatio =
    tokens.length > 0
      ? tokens.filter((token) => HUM_SYLLABLES.has(token.toLowerCase())).length / tokens.length
      : 1;
  const lyricTokenRatio = tokens.length > 0 ? lexicalTokens.length / tokens.length : 0;
  const language = transcription.language === "unknown"
    ? detectLanguage(text)
    : transcription.language;

  const baseDiagnostics: Omit<VoiceRouteDiagnostics, "reason"> = {
    provider: transcription.provider,
    textLength: text.length,
    tokenCount: tokens.length,
    lexicalTokenCount: lexicalTokens.length,
    lyricTokenRatio,
    repeatedSyllableRatio,
    language,
    asrConfidence: transcription.confidence,
    vad: transcription.vad,
    audio: transcription.audio,
    asr: transcription.asrDiagnostics,
  };

  const acousticRejectReason = acousticRejectReasonFor(transcription);
  if (acousticRejectReason) {
    return {
      kind: "hum",
      confidence: Math.max(0.5, 1 - transcription.confidence * 0.25),
      diagnostics: {
        ...baseDiagnostics,
        reason: acousticRejectReason,
      },
    };
  }

  if (
    text.length < 8 ||
    tokens.length < 3 ||
    transcription.confidence < 0.45 ||
    lyricTokenRatio < 0.5 ||
    repeatedSyllableRatio > 0.6
  ) {
    return {
      kind: "hum",
      confidence: Math.max(0.4, 1 - transcription.confidence * lyricTokenRatio),
      diagnostics: {
        ...baseDiagnostics,
        reason: "ambiguous_or_non_lyrical",
      },
    };
  }

  return {
    kind: "voice",
    lyrics: text.slice(0, MAX_LYRIC_CHARS),
    language,
    confidence: Math.min(0.98, transcription.confidence * (0.65 + lyricTokenRatio * 0.35)),
    diagnostics: {
      ...baseDiagnostics,
      reason: "lyrical_speech_detected",
    },
  };
}

export function normalizeLyrics(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

class SpeechWorkerRecognitionProvider implements SpeechRecognitionProvider {
  constructor(private readonly workerBaseUrl: string) {}

  async transcribeSpeech(
    audio: File,
    options: { requestId?: string } = {},
  ): Promise<SpeechTranscription> {
    const form = new FormData();
    form.append("audio", audio, audio.name || "recording.webm");

    const headers = new Headers();
    if (options.requestId) headers.set("X-Request-Id", options.requestId);
    const token = process.env.SPEECH_WORKER_TOKEN?.trim();
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const response = await fetch(speechWorkerAnalyzeUrl(this.workerBaseUrl), {
      method: "POST",
      headers,
      body: form,
      signal: AbortSignal.timeout(speechWorkerTimeoutMs()),
    }).catch((error) => {
      throw new SpeechRecognitionError(
        "provider_http_error",
        error instanceof Error ? error.message : "Speech recognition request failed",
        502,
      );
    });

    if (!response.ok) {
      const detail = await readErrorDetail(response);
      throw new SpeechRecognitionError(
        "provider_http_error",
        `Speech worker returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
        response.status === 401 || response.status === 403 ? 502 : 502,
      );
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    const parsed = parseSpeechWorkerPayload(payload);
    if (!parsed) {
      throw new SpeechRecognitionError(
        "provider_invalid_response",
        "Speech worker returned an invalid response",
        502,
      );
    }

    return parsed;
  }
}

function lyricTokens(text: string): string[] {
  const zh = text.match(/[\u3400-\u9fff]/g) ?? [];
  const latin = text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? [];
  return [...zh, ...latin];
}

function detectLanguage(text: string): SpeechLanguage {
  const zhCount = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const enCount = (text.match(/[A-Za-z]/g) ?? []).length;
  if (zhCount === 0 && enCount === 0) return "unknown";
  return zhCount >= enCount * 0.35 ? "zh" : "en";
}

function normalizeLanguage(language: string): SpeechLanguage {
  const lower = language.toLowerCase();
  if (lower.startsWith("zh") || lower.includes("chinese")) return "zh";
  if (lower.startsWith("en") || lower.includes("english")) return "en";
  return "unknown";
}

export interface SpeechVadDiagnostics {
  provider?: string;
  speechDurationMs?: number;
  speechRatio?: number;
  segmentCount?: number;
  maxSpeechSegmentMs?: number;
  meanSpeechProbability?: number;
  onsetMs?: number;
  offsetMs?: number;
}

export interface SpeechAudioDiagnostics {
  durationMs?: number;
  rmsDbfs?: number;
  peakDbfs?: number;
  snr?: number;
  clippingRatio?: number;
}

export interface SpeechAsrDiagnostics {
  model?: string;
  artifact?: string;
  artifactSha?: string;
  license?: string;
  runtime?: string;
  device?: string;
  computeType?: string;
  languageProbability?: number;
  event?: string;
  emotion?: string;
  avgLogprob?: number;
  noSpeechProb?: number;
  compressionRatio?: number;
  decodeMs?: number;
  totalMs?: number;
}

function acousticRejectReasonFor(transcription: SpeechTranscription): string | null {
  const audio = transcription.audio;
  if (typeof audio?.snr === "number" && audio.snr < MIN_SNR_DB) {
    return "audio_quality_rejected";
  }
  if (
    typeof audio?.clippingRatio === "number" &&
    audio.clippingRatio > MAX_CLIPPING_RATIO
  ) {
    return "audio_quality_rejected";
  }

  const vad = transcription.vad;
  if (!vad) return null;
  if (
    typeof vad.speechDurationMs === "number" &&
    vad.speechDurationMs < MIN_VAD_SPEECH_MS
  ) {
    return "insufficient_vocal_activity";
  }
  if (
    typeof vad.speechRatio === "number" &&
    vad.speechRatio < MIN_VAD_SPEECH_RATIO
  ) {
    return "insufficient_vocal_activity";
  }

  const durationMs = audio?.durationMs;
  if (
    typeof durationMs === "number" &&
    durationMs > 0 &&
    typeof vad.segmentCount === "number"
  ) {
    const fragmentationPer10s = vad.segmentCount / Math.max(durationMs / 10_000, 1);
    if (fragmentationPer10s > MAX_VAD_FRAGMENTATION_PER_10S) {
      return "fragmented_vocal_activity";
    }
  }

  const event = transcription.asrDiagnostics?.event?.toLowerCase();
  if (
    event &&
    event !== "speech" &&
    event !== "unknown" &&
    transcription.confidence < 0.8
  ) {
    return "non_speech_event_detected";
  }

  return null;
}

function speechWorkerAnalyzeUrl(workerBaseUrl: string): string {
  const base = workerBaseUrl.trim().replace(/\/+$/, "");
  return base.endsWith("/analyze-speech") ? base : `${base}/analyze-speech`;
}

function speechWorkerTimeoutMs(): number {
  const raw = Number.parseInt(process.env.SPEECH_WORKER_TIMEOUT_MS ?? "", 10);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SPEECH_WORKER_TIMEOUT_MS;
  return Math.min(Math.max(raw, 1_000), 60_000);
}

function parseSpeechWorkerPayload(payload: unknown): SpeechTranscription | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.text !== "string") return null;

  const provider = typeof record.provider === "string"
    ? record.provider
    : providerFromAsrDiagnostics(record.asrDiagnostics);
  if (!provider) return null;

  return {
    text: record.text,
    language: typeof record.language === "string"
      ? normalizeLanguage(record.language)
      : detectLanguage(record.text),
    confidence: finiteNumber(record.confidence, 0.7),
    segments: parseSpeechSegments(record.segments),
    provider,
    vad: parseVadDiagnostics(record.vad),
    audio: parseAudioDiagnostics(record.audio),
    asrDiagnostics: parseAsrDiagnostics(record.asrDiagnostics),
  };
}

function providerFromAsrDiagnostics(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const runtime = typeof record.runtime === "string" ? record.runtime : "worker";
  const model = typeof record.model === "string" ? record.model : null;
  return model ? `local:${runtime}:${model}` : `local:${runtime}`;
}

function parseSpeechSegments(value: unknown): SpeechSegment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((entry): SpeechSegment[] => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.text !== "string") return [];
    return [{
      text: record.text,
      start: optionalNumber(record.start),
      end: optionalNumber(record.end),
      confidence: optionalNumber(record.confidence),
      avgLogprob: optionalNumber(record.avgLogprob),
      noSpeechProb: optionalNumber(record.noSpeechProb),
      compressionRatio: optionalNumber(record.compressionRatio),
    }];
  });
}

function parseVadDiagnostics(value: unknown): SpeechVadDiagnostics | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return {
    provider: optionalString(record.provider),
    speechDurationMs: optionalNumber(record.speechDurationMs),
    speechRatio: optionalNumber(record.speechRatio),
    segmentCount: optionalNumber(record.segmentCount),
    maxSpeechSegmentMs: optionalNumber(record.maxSpeechSegmentMs),
    meanSpeechProbability: optionalNumber(record.meanSpeechProbability),
    onsetMs: optionalNumber(record.onsetMs),
    offsetMs: optionalNumber(record.offsetMs),
  };
}

function parseAudioDiagnostics(value: unknown): SpeechAudioDiagnostics | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return {
    durationMs: optionalNumber(record.durationMs),
    rmsDbfs: optionalNumber(record.rmsDbfs),
    peakDbfs: optionalNumber(record.peakDbfs),
    snr: optionalNumber(record.snr),
    clippingRatio: optionalNumber(record.clippingRatio),
  };
}

function parseAsrDiagnostics(value: unknown): SpeechAsrDiagnostics | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return {
    model: optionalString(record.model),
    artifact: optionalString(record.artifact),
    artifactSha: optionalString(record.artifactSha),
    license: optionalString(record.license),
    runtime: optionalString(record.runtime),
    device: optionalString(record.device),
    computeType: optionalString(record.computeType),
    languageProbability: optionalNumber(record.languageProbability),
    event: optionalString(record.event),
    emotion: optionalString(record.emotion),
    avgLogprob: optionalNumber(record.avgLogprob),
    noSpeechProb: optionalNumber(record.noSpeechProb),
    compressionRatio: optionalNumber(record.compressionRatio),
    decodeMs: optionalNumber(record.decodeMs),
    totalMs: optionalNumber(record.totalMs),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

async function readErrorDetail(response: Response): Promise<string | null> {
  try {
    const payload = (await response.json()) as unknown;
    if (payload && typeof payload === "object") {
      const message = (payload as { error?: { message?: unknown }; message?: unknown }).error?.message
        ?? (payload as { message?: unknown }).message;
      return typeof message === "string" ? message.slice(0, 240) : null;
    }
  } catch {
    // no JSON body
  }
  return null;
}
