import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const WEB_PORT = Number.parseInt(process.env.MURMUR_VOICE_SMOKE_WEB_PORT ?? "3300", 10);
const SPEECH_PORT = Number.parseInt(process.env.MURMUR_VOICE_SMOKE_SPEECH_PORT ?? "8303", 10);
const webBase = (process.env.MURMUR_WEB_BASE_URL ?? `http://127.0.0.1:${WEB_PORT}`).replace(/\/+$/, "");
const localHeaders = {
  "x-murmur-user-id": "voice_e2e_smoke",
  "x-request-id": `voice-e2e-${Date.now()}`,
};
const speechToken = process.env.SPEECH_WORKER_TOKEN ?? "voice-smoke-token";

type AnalyzeResult =
  | {
      kind: "hum";
      transcription: {
        provider: string;
        rawNotes: Array<{ pitch: number; start: number; duration: number; velocity: number; confidence: number }>;
        selectedMelodyKind: "intent" | "corrected" | "musical";
        cleanMelody: {
          notes: Array<{ pitch: number; start: number; duration: number; velocity: number; confidence: number }>;
          key: string;
          scale: string;
          bpm: number;
          duration: number;
          contour: string;
        };
      };
    }
  | {
      kind: "voice";
      lyrics: string;
      language: "zh" | "en" | "unknown";
      confidence: number;
      diagnostics: Record<string, unknown>;
    };

type ProcessHandle = ReturnType<typeof spawn>;

async function main() {
  const speechLog = join(tmpdir(), `murmur-speech-${Date.now()}.log`);
  const webLog = join(tmpdir(), `murmur-web-${Date.now()}.log`);
  const speechWorker = startSpeechWorker(speechLog);
  let web: ProcessHandle | null = null;

  try {
    await buildWeb(webLog);
    web = startWeb(webLog);
    await waitForUrl(`http://127.0.0.1:${SPEECH_PORT}/health`, "speech-worker", speechLog);
    await waitForUrl(`${webBase}`, "web", webLog);

    await checkCaptureRoute();
    await checkVoiceGenerate();
    await checkSaveSong();
    await checkReopenSong();
    console.log("Voice e2e smoke passed.");
  } finally {
    speechWorker.kill("SIGTERM");
    web?.kill("SIGTERM");
  }
}

let voicePayload: AnalyzeResult | null = null;
let voiceGeneration: {
  mp3Url: string;
  audioObjectKey: string;
  providerModel: string;
  contentType: string;
  durationSec: number | null;
} | null = null;
let savedSongId = "";

function startSpeechWorker(logPath: string): ProcessHandle {
  const env = {
    ...process.env,
    SPEECH_ENGINE_MOCK_TEXT: "I can sing this line",
    SPEECH_WORKER_PRIMARY_PROVIDER: "sensevoice",
    SPEECH_WORKER_TOKEN: speechToken,
    SPEECH_WORKER_MODEL_ARTIFACT: process.env.SPEECH_WORKER_MODEL_ARTIFACT ?? "sensevoice-small-gguf",
    SPEECH_WORKER_MODEL_SHA: process.env.SPEECH_WORKER_MODEL_SHA ?? "voice-smoke-sha",
  };
  const proc = spawn(resolve(ROOT, "workers/speech-engine/.venv/bin/python"), ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(SPEECH_PORT)], {
    cwd: resolve(ROOT, "workers/speech-engine"),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeLogs(proc, logPath, "speech");
  return proc;
}

function startWeb(logPath: string): ProcessHandle {
  const env = {
    ...process.env,
    AUDIO_WORKER_URL: process.env.AUDIO_WORKER_URL ?? "http://127.0.0.1:8001",
    AUTH_SECRET: process.env.AUTH_SECRET ?? "voice-smoke-secret",
    DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://postgres:password@127.0.0.1:5432/murmur_voice_smoke",
    MURMUR_AUTH_MODE: process.env.MURMUR_AUTH_MODE ?? "local",
    MURMUR_ENABLE_DEBUG_SURFACE: "1",
    MURMUR_STORAGE_DRIVER: "memory",
    MURMUR_VOICE_INPUT_ENABLED: "1",
    SPEECH_WORKER_URL: `http://127.0.0.1:${SPEECH_PORT}`,
    SPEECH_WORKER_TOKEN: speechToken,
    MINIMAX_API_KEY: process.env.MINIMAX_API_KEY ?? "voice-smoke",
    MINIMAX_MUSIC_MOCK: "1",
    MINIMAX_GROUP_ID: "",
  };
  const proc = spawn("bun", ["start", "--hostname", "127.0.0.1", "--port", String(WEB_PORT)], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeLogs(proc, logPath, "web");
  return proc;
}

async function buildWeb(logPath: string) {
  const proc = spawn("bun", ["run", "build"], {
    cwd: ROOT,
    env: {
      ...process.env,
      AUDIO_WORKER_URL: process.env.AUDIO_WORKER_URL ?? "http://127.0.0.1:8001",
      MURMUR_VOICE_INPUT_ENABLED: "1",
      SPEECH_WORKER_URL: `http://127.0.0.1:${SPEECH_PORT}`,
      SPEECH_WORKER_TOKEN: speechToken,
      MINIMAX_MUSIC_MOCK: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeLogs(proc, logPath, "build");
  const exit = await waitForExit(proc, "build");
  if (exit !== 0) {
    throw new Error(`Voice smoke build failed with exit code ${exit}`);
  }
}

async function checkCaptureRoute() {
  const form = new FormData();
  form.append("audio", new Blob([makeWavBytes()], { type: "audio/wav" }), "voice.wav");
  form.append("targetInstrument", "piano");

  const response = await fetch(`${webBase}/api/capture/analyze`, {
    method: "POST",
    headers: localHeaders,
    body: form,
  });
  voicePayload = (await response.json()) as AnalyzeResult;
  if (response.status !== 200 || voicePayload.kind !== "voice") {
    throw new Error(`expected voice route, got status=${response.status} body=${JSON.stringify(voicePayload)}`);
  }
  if (!voicePayload.lyrics) throw new Error("missing lyrics");
  console.log(`PASS capture route: ${voicePayload.language} voice`);
}

async function checkVoiceGenerate() {
  if (!voicePayload || voicePayload.kind !== "voice") throw new Error("capture payload missing");

  const response = await fetch(`${webBase}/api/music/voice-generate`, {
    method: "POST",
    headers: { ...localHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      lyrics: voicePayload.lyrics,
      stylePrompt: "warm intimate pop",
      title: "Voice Smoke",
      draftId: `voice_smoke_${Date.now()}`,
    }),
  });
  voiceGeneration = (await response.json()) as typeof voiceGeneration;
  if (response.status !== 200 || !voiceGeneration?.mp3Url) {
    throw new Error(`voice generate failed status=${response.status} body=${JSON.stringify(voiceGeneration)}`);
  }
  console.log(`PASS voice generate: ${voiceGeneration.providerModel}`);
}

async function checkSaveSong() {
  if (!voicePayload || !voiceGeneration) throw new Error("voice steps missing");
  const response = await fetch(`${webBase}/api/songs`, {
    method: "POST",
    headers: { ...localHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      id: `song_voice_smoke_${Date.now()}`,
      title: "Voice Smoke",
      vibe: "voice_song",
      vibeEn: "Voice song",
      bpm: 120,
      keySignature: "C",
      scaleType: "major",
      duration: 12,
      parentSongId: null,
      rootSongId: null,
      lineageDepth: 0,
      sourceMelodyKind: "corrected",
      editCount: 0,
      editDepth: "fresh",
      mp3Url: voiceGeneration.mp3Url,
      mp3DataUrl: null,
      inputKind: "voice",
      lyrics: voicePayload.lyrics,
      generationProvider: voiceGeneration.providerModel,
      visualConfig: {
        preset: "voice_song",
        gradient: "linear-gradient(135deg, #18313F, #4A9B8E)",
        particleDensity: 0.5,
        pulseSource: "energy",
      },
      arrangementState: defaultArrangementState(),
      tags: [],
    }),
  });
  const body = await response.json();
  if (!response.ok || typeof body.id !== "string") {
    throw new Error(`save failed status=${response.status} body=${JSON.stringify(body)}`);
  }
  savedSongId = body.id;
  console.log(`PASS save song: ${savedSongId}`);
}

async function checkReopenSong() {
  if (!savedSongId) throw new Error("missing saved song id");
  const response = await fetch(`${webBase}/api/songs/${encodeURIComponent(savedSongId)}`, {
    headers: localHeaders,
  });
  const body = await response.json();
  if (!response.ok || body.id !== savedSongId) {
    throw new Error(`reopen failed status=${response.status} body=${JSON.stringify(body)}`);
  }
  console.log(`PASS reopen song: ${body.id}`);
}

function defaultArrangementState() {
  return {
    melody: defaultTrackState("piano", "60"),
    chords: defaultTrackState("felt_piano", "gen:voice"),
    strings: defaultTrackState("string_ensemble", "pad"),
    drums: defaultTrackState("brush_kit", "brush"),
    bass: defaultTrackState("upright_bass", "root"),
    texture: defaultTrackState("vinyl_noise", "air"),
  };
}

function defaultTrackState(instrument: string, pattern: string) {
  return {
    enabled: true,
    intensity: 0.5,
    originalPattern: pattern,
    currentPattern: pattern,
    instrument,
    versionHistory: [],
  };
}

async function waitForUrl(url: string, label: string, logPath: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, { headers: localHeaders });
      if (response.ok) return;
    } catch {
      // retry
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${label} at ${url}. Log: ${logPath}`);
}

function pipeLogs(proc: ProcessHandle, logPath: string, label: string) {
  const out = createWriteStream(logPath, { flags: "a" });
  proc.stdout?.on("data", (chunk) => {
    process.stdout.write(`[${label}] ${chunk.toString()}`);
    out.write(chunk);
  });
  proc.stderr?.on("data", (chunk) => {
    process.stderr.write(`[${label}] ${chunk.toString()}`);
    out.write(chunk);
  });
}

async function waitForExit(proc: ProcessHandle, label: string): Promise<number> {
  return await new Promise((resolve) => {
    proc.on("exit", (code) => {
      resolve(code ?? 0);
    });
    proc.on("error", () => {
      resolve(1);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeWavBytes(): Uint8Array {
  const sampleRate = 16000;
  const durationSec = 1;
  const samples = sampleRate * durationSec;
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < samples; i += 1) {
    const sample = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 12000;
    view.setInt16(44 + i * 2, sample, true);
  }
  return new Uint8Array(buffer);
}

await main();
