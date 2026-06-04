import { describe, expect, it, beforeEach, mock } from "bun:test";
import type { NextRequest } from "next/server";
import type {
  BalanceResult,
  SpendNotesInput,
  SpendNotesResult,
} from "@/lib/db/queries/notes-ledger";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";
import type { TranscriptionResult } from "@/modules/shared/types";

// State each test case mutates before invoking the route. Module mocks
// below read these closures, so tests stay declarative.
let nextAuth: ResolvedRequestAuth = {
  ok: true,
  user: { id: "usr_test", email: null, name: "Test User", avatarUrl: null },
  source: "guest",
  sessionId: null,
};
let nextBalance: BalanceResult = {
  ok: true,
  userId: "usr_test",
  notes: 10,
  planTier: "free",
  freeNotesGrantedAt: new Date(),
};
let nextSpendResult: SpendNotesResult = {
  ok: true,
  ledgerId: "nle_test",
  balanceBefore: 10,
  balanceAfter: 9,
  duplicate: false,
};
let nextSpendThrows: Error | null = null;
let nextWorkerImpl: (() => Promise<TranscriptionResult>) | null = null;
const lastSpendInputs: SpendNotesInput[] = [];

const stubTranscription: TranscriptionResult = {
  provider: "swiftf0",
  rawNotes: [
    { pitch: 64, start: 0, duration: 0.4, velocity: 0.7, confidence: 0.9 },
    { pitch: 67, start: 0.5, duration: 0.4, velocity: 0.7, confidence: 0.9 },
  ],
  cleanMelody: {
    notes: [
      { pitch: 64, start: 0, duration: 0.5, velocity: 0.7, confidence: 0.9 },
      { pitch: 67, start: 0.5, duration: 0.5, velocity: 0.7, confidence: 0.9 },
    ],
    key: "C",
    scale: "major",
    bpm: 120,
    duration: 1.0,
    contour: "rising",
  },
  warnings: [],
  diagnostics: {
    duration: 1.0,
    snr: 22.5,
    voicedRatio: 0.85,
    pitchMs: 32,
    polishMs: 4,
    workerMs: 60,
    targetInstrument: "piano",
    rangeClampApplied: false,
  },
};

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async () => nextAuth,
}));

mock.module("@/lib/db/queries/notes-ledger", () => ({
  getNotesBalance: async () => nextBalance,
  spendNotes: async (input: SpendNotesInput) => {
    lastSpendInputs.push(input);
    if (nextSpendThrows) throw nextSpendThrows;
    return nextSpendResult;
  },
}));

class TestAudioWorkerError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = "AudioWorkerError";
    this.code = code;
    this.status = status;
  }
}

mock.module("@/lib/platform/audio-worker", () => {
  const MELODY_INSTRUMENTS = new Set([
    "piano",
    "bell",
    "electric_piano",
    "acoustic_guitar",
    "marimba",
    "synth_lead",
    "arp_synth",
    "cello_pad",
  ]);
  const BASS_INSTRUMENTS = new Set([
    "upright_bass",
    "soft_bass",
    "synth_bass",
    "sub_bass",
  ]);
  return {
    AudioWorkerError: TestAudioWorkerError,
    transcribeWithAudioWorker: async (...args: unknown[]) => {
      if (!nextWorkerImpl) {
        throw new Error("test forgot to set nextWorkerImpl");
      }
      return nextWorkerImpl(...(args as []));
    },
    isInstrumentId: (value: string) =>
      MELODY_INSTRUMENTS.has(value) || BASS_INSTRUMENTS.has(value),
    isMelodyCarrier: (value: string) => MELODY_INSTRUMENTS.has(value),
  };
});

const { POST } = await import("./route");
const AudioWorkerError = TestAudioWorkerError;

function audioFile(bytes = 1024, type = "audio/webm"): File {
  return new File([new Uint8Array(bytes)], "hum.webm", { type });
}

function buildRequest(
  form: FormData,
  options: { requestId?: string } = {},
): NextRequest {
  const headers = new Headers();
  if (options.requestId) headers.set("x-request-id", options.requestId);
  return new Request("http://test.local/api/transcribe", {
    method: "POST",
    body: form,
    headers,
  }) as unknown as NextRequest;
}

beforeEach(() => {
  nextAuth = {
    ok: true,
    user: { id: "usr_test", email: null, name: "Test User", avatarUrl: null },
    source: "guest",
    sessionId: null,
  };
  nextBalance = {
    ok: true,
    userId: "usr_test",
    notes: 10,
    planTier: "free",
    freeNotesGrantedAt: new Date(),
  };
  nextSpendResult = {
    ok: true,
    ledgerId: "nle_test",
    balanceBefore: 10,
    balanceAfter: 9,
    duplicate: false,
  };
  nextSpendThrows = null;
  nextWorkerImpl = async () => stubTranscription;
  lastSpendInputs.length = 0;
});

describe("POST /api/transcribe", () => {
  it("returns the polished melody and debits a note on success", async () => {
    const form = new FormData();
    form.append("audio", audioFile());
    form.append("targetInstrument", "piano");

    const response = await POST(buildRequest(form, { requestId: "req_happy" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Request-Id")).toBe("req_happy");

    const body = (await response.json()) as TranscriptionResult;
    expect(body.provider).toBe("swiftf0");
    expect(body.cleanMelody.notes).toHaveLength(2);
    expect(lastSpendInputs).toHaveLength(1);
    expect(lastSpendInputs[0]?.reason).toBe("spend:hum");
    expect(lastSpendInputs[0]?.cost).toBe(1);
  });

  it("rejects missing audio with audio_required", async () => {
    const form = new FormData();
    form.append("targetInstrument", "piano");
    const response = await POST(buildRequest(form));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("audio_required");
    expect(lastSpendInputs).toHaveLength(0);
  });

  it("rejects payloads over the size cap with audio_too_large", async () => {
    const oversize = audioFile(2 * 1024 * 1024 + 16);
    const form = new FormData();
    form.append("audio", oversize);
    form.append("targetInstrument", "piano");
    const response = await POST(buildRequest(form));
    expect(response.status).toBe(413);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("audio_too_large");
  });

  it("rejects non-melody instruments with validation_error", async () => {
    const form = new FormData();
    form.append("audio", audioFile());
    form.append("targetInstrument", "upright_bass");
    const response = await POST(buildRequest(form));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });

  it("returns 402 with balance details when notes are insufficient", async () => {
    nextBalance = {
      ok: true,
      userId: "usr_test",
      notes: 0,
      planTier: "free",
      freeNotesGrantedAt: new Date(),
    };
    const form = new FormData();
    form.append("audio", audioFile());
    const response = await POST(buildRequest(form));
    expect(response.status).toBe(402);
    const body = (await response.json()) as {
      error: string;
      currentBalance: number;
      cost: number;
    };
    expect(body.error).toBe("insufficient_notes");
    expect(body.currentBalance).toBe(0);
    expect(body.cost).toBe(1);
    expect(lastSpendInputs).toHaveLength(0);
  });

  it("surfaces the worker's no_voiced_frames as 422", async () => {
    nextWorkerImpl = async () => {
      throw new AudioWorkerError(
        "no_voiced_frames",
        "Audio worker found no voiced notes",
        422,
      );
    };
    const form = new FormData();
    form.append("audio", audioFile());
    const response = await POST(buildRequest(form));
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("no_voiced_frames");
    expect(lastSpendInputs).toHaveLength(0);
  });

  it("returns 502 when the worker is unreachable", async () => {
    nextWorkerImpl = async () => {
      throw new AudioWorkerError(
        "worker_http_error",
        "Audio worker unreachable",
        502,
      );
    };
    const form = new FormData();
    form.append("audio", audioFile());
    const response = await POST(buildRequest(form));
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("worker_http_error");
    expect(lastSpendInputs).toHaveLength(0);
  });

  it("returns 503 when the ledger spend throws", async () => {
    nextSpendThrows = new Error("db transient outage");
    const form = new FormData();
    form.append("audio", audioFile());
    const response = await POST(buildRequest(form));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("billing_unavailable");
  });

  it("respects the auth resolver returning a 401 envelope", async () => {
    nextAuth = {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    };
    const form = new FormData();
    form.append("audio", audioFile());
    const response = await POST(buildRequest(form));
    expect(response.status).toBe(401);
    expect(lastSpendInputs).toHaveLength(0);
  });
});
