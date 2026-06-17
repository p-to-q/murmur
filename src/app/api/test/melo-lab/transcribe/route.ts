import { NextRequest, NextResponse } from "next/server";
import {
  AudioWorkerError,
  isInstrumentId,
  isMelodyCarrier,
  normalizeWorkerResponse,
} from "@/lib/platform/audio-worker";
import { meloLabGate, resolveLocalWorkerUrl, summarizeMelody } from "@/lib/test/melo-lab";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const PITCH_PROVIDERS = ["auto", "swiftf0", "pyin", "yin", "parselmouth"] as const;
type PitchProviderId = (typeof PITCH_PROVIDERS)[number];

/**
 * TEST ONLY: POST /api/test/melo-lab/transcribe
 *
 * Direct local transcription probe for /me/debug/melo-lab. This intentionally
 * bypasses production auth, billing, and remote workers so we can inspect the
 * audio-engine JSON and Murmur's repair layers on a developer machine.
 */
export async function POST(request: NextRequest) {
  const gate = meloLabGate(request.headers.get("host"));
  if (!gate.ok) {
    return NextResponse.json(
      { error: "melo_lab_disabled", message: "Melo-lab is local/test only." },
      { status: 404 },
    );
  }

  const workerBase = resolveLocalWorkerUrl(
    process.env.MELO_LAB_AUDIO_WORKER_URL || process.env.AUDIO_WORKER_URL,
    "http://127.0.0.1:8001",
  );
  if (!workerBase) {
    return NextResponse.json(
      {
        error: "local_audio_worker_required",
        message: "Set MELO_LAB_AUDIO_WORKER_URL or AUDIO_WORKER_URL to a localhost worker.",
      },
      { status: 503 },
    );
  }

  try {
    const formData = await request.formData();
    const audio = formData.get("audio");
    const targetInstrumentRaw = formData.get("targetInstrument");
    const targetInstrument =
      typeof targetInstrumentRaw === "string" && targetInstrumentRaw.trim()
        ? targetInstrumentRaw.trim()
        : "piano";
    const pitchProvider = parsePitchProvider(formData.get("pitchProvider"));

    if (!(audio instanceof File) || audio.size === 0) {
      return NextResponse.json(
        { error: "audio_required", message: "Audio file is required." },
        { status: 400 },
      );
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { error: "audio_too_large", message: "Audio file must be 8 MB or smaller." },
        { status: 413 },
      );
    }
    if (!isInstrumentId(targetInstrument) || !isMelodyCarrier(targetInstrument)) {
      return NextResponse.json(
        { error: "validation_error", message: "targetInstrument must carry melody." },
        { status: 400 },
      );
    }

    const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
    const workerForm = new FormData();
    workerForm.append("audio", audio, audio.name || "hum.webm");
    workerForm.append("targetInstrument", targetInstrument);
    workerForm.append("pitchProvider", pitchProvider);

    const headers = new Headers({ "X-Request-Id": requestId });
    const token = process.env.AUDIO_WORKER_TOKEN?.trim();
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const workerUrl = workerBase.endsWith("/transcribe")
      ? workerBase
      : `${workerBase}/transcribe`;
    const startedAt = performance.now();
    const workerResponse = await fetch(workerUrl, {
      method: "POST",
      body: workerForm,
      headers,
      signal: AbortSignal.timeout(90_000),
    });

    if (!workerResponse.ok) {
      const detail = await readJsonSafely(workerResponse);
      return NextResponse.json(
        {
          error: "audio_worker_failed",
          message: `Local audio worker returned HTTP ${workerResponse.status}`,
          detail,
        },
        { status: workerResponse.status === 422 ? 422 : 502 },
      );
    }

    const workerJson = await workerResponse.json();
    const result = normalizeWorkerResponse(
      workerJson as Parameters<typeof normalizeWorkerResponse>[0],
      {
        targetInstrument,
        workerMs: Math.round(performance.now() - startedAt),
      },
    );

    return NextResponse.json({
      testOnly: true,
      workerUrl,
      requestId,
      pitchProvider,
      requestedProvider: requestedProviderFromWorker(workerJson, pitchProvider),
      result,
      stages: {
        raw: {
          notes: result.rawNotes,
          summary: {
            noteCount: result.rawNotes.length,
            duration:
              result.rawNotes.length > 0
                ? Math.max(...result.rawNotes.map((note) => note.start + note.duration))
                : 0,
          },
        },
        intent: {
          melody: result.melodies.intent,
          summary: summarizeMelody(result.melodies.intent),
        },
        corrected: {
          melody: result.melodies.corrected,
          summary: summarizeMelody(result.melodies.corrected),
        },
        musical: {
          melody: result.melodies.musical,
          summary: summarizeMelody(result.melodies.musical),
        },
      },
    });
  } catch (error) {
    if (error instanceof AudioWorkerError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        error: "melo_lab_transcribe_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

function parsePitchProvider(value: FormDataEntryValue | null): PitchProviderId {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!raw) return "auto";
  if (PITCH_PROVIDERS.includes(raw as PitchProviderId)) {
    return raw as PitchProviderId;
  }
  throw new AudioWorkerError(
    "validation_error",
    "pitchProvider must be auto, swiftf0, pyin, yin, or parselmouth.",
    400,
  );
}

function requestedProviderFromWorker(
  value: unknown,
  fallback: PitchProviderId,
): string {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.requestedProvider === "string") {
      return record.requestedProvider;
    }
  }
  return fallback;
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
