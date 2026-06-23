import { describe, expect, it, beforeEach, mock } from "bun:test";
import type { NextRequest } from "next/server";
import type {
  BalanceResult,
  RefundNotesInput,
  SpendNotesInput,
  SpendNotesResult,
} from "@/lib/db/queries/notes-ledger";
import { getRateLimitStore, resetCachedRateLimitStore } from "@/lib/rate-limit";
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
  accountNotes: 5,
  dailyFreeNotes: 5,
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
let nextBalanceThrows: Error | null = null;
let nextRefundThrows: Error | null = null;
let nextWorkerImpl: (() => Promise<TranscriptionResult>) | null = null;
const lastSpendInputs: SpendNotesInput[] = [];
const lastRefundInputs: RefundNotesInput[] = [];
let lastResolveAuthOptions: { allowGuestPreview?: boolean } | null = null;

const stubTranscription: TranscriptionResult = {
  provider: "swiftf0",
  rawNotes: [
    { pitch: 64, start: 0, duration: 0.4, velocity: 0.7, confidence: 0.9 },
    { pitch: 67, start: 0.5, duration: 0.4, velocity: 0.7, confidence: 0.9 },
  ],
  melodies: {
    intent: {
      notes: [
        { pitch: 64, start: 0, duration: 0.4, velocity: 0.7, confidence: 0.9 },
        { pitch: 67, start: 0.5, duration: 0.4, velocity: 0.7, confidence: 0.9 },
      ],
      key: "C",
      scale: "major",
      bpm: 120,
      duration: 0.9,
      contour: "rising",
    },
    corrected: {
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
    musical: {
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
  },
  selectedMelodyKind: "corrected",
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
  resolveRequestAuth: async (
    _request: Request,
    options: { allowGuestPreview?: boolean } = {},
  ) => {
    lastResolveAuthOptions = options;
    return nextAuth;
  },
}));

mock.module("@/lib/db/queries/notes-ledger", () => ({
  getNotesBalance: async () => {
    if (nextBalanceThrows) throw nextBalanceThrows;
    return nextBalance;
  },
  spendNotes: async (input: SpendNotesInput) => {
    lastSpendInputs.push(input);
    if (nextSpendThrows) throw nextSpendThrows;
    return nextSpendResult;
  },
  refundNotes: async (input: RefundNotesInput) => {
    lastRefundInputs.push(input);
    if (nextRefundThrows) throw nextRefundThrows;
    return {
      ok: true as const,
      refundLedgerId: "nle_refund",
      originalLedgerId: input.originalLedgerId,
      balanceBefore: 9,
      balanceAfter: 10,
      amount: 1,
      duplicate: false,
    };
  },
  reverseTopupGrant: async () => ({ ok: false as const, reason: "purchase_grant_not_found" as const }),
  // Unused here, but every mock of this module must declare the full export
  // surface — bun can't add new export names to an already-created record.
  grantNotes: async () => ({
    ok: true as const,
    ledgerId: "nle_grant",
    balanceBefore: 0,
    balanceAfter: 0,
    duplicate: false,
  }),
  grantNotesInTransaction: async () => ({
    ok: true as const,
    ledgerId: "nle_grant_tx",
    balanceBefore: 0,
    balanceAfter: 0,
    duplicate: false,
  }),
  decideGrant: () => ({ kind: "grant", balanceAfter: 0 }),
  decideSpend: () => ({ kind: "insufficient", currentBalance: 0 }),
  decideRefund: () => ({ kind: "original_missing" }),
  decideSpendPoolsForCost: () => ({
    dailyFreeBefore: 0,
    accountBefore: 0,
    dailyFreeSpent: 0,
    accountSpent: 0,
    dailyFreeAfter: 0,
    accountAfter: 0,
  }),
  decideRefundPoolsForOriginalSpend: () => ({
    dailyFreeRestore: 0,
    accountRestore: 0,
    dailyFreeAfter: 0,
    accountAfter: 0,
  }),
  accountNotesFromTotal: (total: number, dailyFree: number) => Math.max(0, total - dailyFree),
  trimDailyFreeAfterTopupReversal: (dailyFree: number, total: number) => Math.min(dailyFree, total),
  refundReferenceFor: (id: string) => `refund:${id}`,
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
  options: { requestId?: string; url?: string } = {},
): NextRequest {
  const headers = new Headers();
  if (options.requestId) headers.set("x-request-id", options.requestId);
  return new Request(options.url ?? "http://test.local/api/transcribe", {
    method: "POST",
    body: form,
    headers,
  }) as unknown as NextRequest;
}

beforeEach(() => {
  delete process.env.MURMUR_RATE_LIMIT_DRIVER;
  resetCachedRateLimitStore();
  getRateLimitStore().resetAll();
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
    accountNotes: 5,
    dailyFreeNotes: 5,
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
  nextBalanceThrows = null;
  nextRefundThrows = null;
  nextWorkerImpl = async () => stubTranscription;
  lastSpendInputs.length = 0;
  lastRefundInputs.length = 0;
  lastResolveAuthOptions = null;
});

describe("POST /api/transcribe", () => {
  it("returns the polished melody and debits a note on success", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const form = new FormData();
    form.append("audio", audioFile());
    form.append("targetInstrument", "piano");

    try {
      const response = await POST(buildRequest(form, { requestId: "req_happy" }));
      expect(response.status).toBe(200);
      expect(response.headers.get("X-Request-Id")).toBe("req_happy");

      const body = (await response.json()) as TranscriptionResult;
      expect(body.provider).toBe("swiftf0");
      expect(body.cleanMelody.notes).toHaveLength(2);
      expect(body.melodies.corrected.notes).toHaveLength(2);
      expect(body.selectedMelodyKind).toBe("corrected");
      expect(lastSpendInputs).toHaveLength(1);
      expect(lastRefundInputs).toHaveLength(0);
      expect(lastSpendInputs[0]?.reason).toBe("spend:hum");
      expect(lastSpendInputs[0]?.cost).toBe(1);
      expect(lastSpendInputs[0]?.externalRef).toStartWith("hum:");
      expect(lastSpendInputs[0]?.externalRef).not.toBe("req_happy");
      expect(lastSpendInputs[0]?.metadata?.requestId).toBe("req_happy");
      expect(lastResolveAuthOptions?.allowGuestPreview).toBe(false);
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
    }
  });

  it("does not reuse client request ids as spend idempotency keys", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      for (let i = 0; i < 2; i += 1) {
        const form = new FormData();
        form.append("audio", audioFile());
        form.append("targetInstrument", "piano");
        const response = await POST(buildRequest(form, { requestId: "req_replayed" }));
        expect(response.status).toBe(200);
      }

      expect(lastSpendInputs).toHaveLength(2);
      expect(lastSpendInputs[0]?.externalRef).toStartWith("hum:");
      expect(lastSpendInputs[1]?.externalRef).toStartWith("hum:");
      expect(lastSpendInputs[0]?.externalRef).not.toBe(lastSpendInputs[1]?.externalRef);
      expect(lastSpendInputs[0]?.externalRef).not.toBe("req_replayed");
      expect(lastSpendInputs[1]?.externalRef).not.toBe("req_replayed");
      expect(lastSpendInputs[0]?.metadata?.requestId).toBe("req_replayed");
      expect(lastSpendInputs[1]?.metadata?.requestId).toBe("req_replayed");
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
    }
  });

  it("allows RMVPE worker results through the stable transcribe route", async () => {
    nextWorkerImpl = async () => ({
      ...stubTranscription,
      provider: "rmvpe",
      diagnostics: {
        ...stubTranscription.diagnostics,
        rmvpeFrames: 120,
        rmvpeVoicedFrames: 98,
      },
    });
    const form = new FormData();
    form.append("audio", audioFile());
    form.append("targetInstrument", "piano");

    const response = await POST(buildRequest(form, { requestId: "req_rmvpe" }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as TranscriptionResult;
    expect(body.provider).toBe("rmvpe");
    expect(body.diagnostics?.rmvpeFrames).toBe(120);
    expect(lastSpendInputs).toHaveLength(1);
  });

  it("spends Local Creator ledger notes on localhost when a balance row exists", async () => {
    nextAuth = {
      ok: true,
      user: {
        id: "lc_test",
        email: null,
        name: "Local Creator",
        avatarUrl: null,
        accountKind: "local_creator",
      },
      source: "session",
      sessionId: "sess_local",
    };
    nextBalance = {
      ok: true,
      userId: "lc_test",
      notes: 5,
      accountNotes: 5,
      dailyFreeNotes: 0,
      planTier: "free",
      freeNotesGrantedAt: new Date(),
    };
    const form = new FormData();
    form.append("audio", audioFile());

    const response = await POST(
      buildRequest(form, {
        requestId: "req_local_creator",
        url: "http://localhost:3000/api/transcribe",
      }),
    );

    expect(response.status).toBe(200);
    expect(lastResolveAuthOptions?.allowGuestPreview).toBe(true);
    expect(lastSpendInputs).toHaveLength(1);
    expect(lastSpendInputs[0]).toMatchObject({
      userId: "lc_test",
      reason: "spend:hum",
      cost: 1,
    });
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
      accountNotes: 0,
      dailyFreeNotes: 0,
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

  it("returns 429 before billing or worker work when rate-limited", async () => {
    const store = getRateLimitStore();
    const form = new FormData();
    form.append("audio", audioFile());
    form.append("targetInstrument", "piano");

    for (let i = 0; i < 10; i += 1) {
      await store.hit("/api/transcribe:user:usr_test:unknown", {
        capacity: 10,
        refillWindowMs: 60_000,
      });
    }

    const response = await POST(buildRequest(form, { requestId: "req_rate_limited" }));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(response.headers.get("X-RateLimit-Limit")).toBe("10");
    const body = await response.json() as { error: string; requestId: string };
    expect(body.error).toBe("rate_limited");
    expect(body.requestId).toBe("req_rate_limited");
    expect(lastSpendInputs).toHaveLength(0);
    expect(lastRefundInputs).toHaveLength(0);
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
    expect(lastSpendInputs).toHaveLength(1);
    expect(lastRefundInputs).toHaveLength(1);
    expect(lastRefundInputs[0]?.originalLedgerId).toBe("nle_test");
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
    expect(lastSpendInputs).toHaveLength(1);
    expect(lastRefundInputs).toHaveLength(1);
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

  it("keeps local demos usable when billing is unavailable in development", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevFlag = process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
    process.env.NODE_ENV = "development";
    process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = "1";
    nextBalanceThrows = new Error("db offline");

    try {
      const form = new FormData();
      form.append("audio", audioFile());
      const response = await POST(buildRequest(form, { requestId: "req_dev_bypass" }));
      expect(response.status).toBe(200);
      const body = (await response.json()) as TranscriptionResult;
      expect(body.provider).toBe("swiftf0");
      expect(lastSpendInputs).toHaveLength(0);
      expect(lastRefundInputs).toHaveLength(0);
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      if (prevFlag === undefined) {
        delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
      } else {
        process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = prevFlag;
      }
    }
  });

  it("bypasses insufficient balance in development when dev billing fallback is enabled", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevFlag = process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
    process.env.NODE_ENV = "development";
    process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = "1";
    nextBalance = {
      ok: true,
      userId: "usr_test",
      notes: 0,
      accountNotes: 0,
      dailyFreeNotes: 0,
      planTier: "free",
      freeNotesGrantedAt: new Date(),
    };

    try {
      const form = new FormData();
      form.append("audio", audioFile());
      const response = await POST(buildRequest(form, { requestId: "req_dev_unlimited" }));
      expect(response.status).toBe(200);
      expect(lastSpendInputs).toHaveLength(0);
      expect(lastRefundInputs).toHaveLength(0);
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      if (prevFlag === undefined) {
        delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
      } else {
        process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = prevFlag;
      }
    }
  });

  it("rejects production dev billing fallback even on localhost", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevFlag = process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
    process.env.NODE_ENV = "production";
    process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = "1";
    nextBalanceThrows = new Error("db offline");

    try {
      const form = new FormData();
      form.append("audio", audioFile());
      const response = await POST(
        buildRequest(form, {
          requestId: "req_localhost_bypass",
          url: "http://localhost:3000/api/transcribe",
        }),
      );
      expect(response.status).toBe(503);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("billing_unavailable");
      expect(lastSpendInputs).toHaveLength(0);
      expect(lastRefundInputs).toHaveLength(0);
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      if (prevFlag === undefined) {
        delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
      } else {
        process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = prevFlag;
      }
    }
  });

  it("respects the auth resolver returning a 401 envelope", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    nextAuth = {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    };
    const form = new FormData();
    form.append("audio", audioFile());
    try {
      const response = await POST(buildRequest(form));
      expect(response.status).toBe(401);
      expect(lastSpendInputs).toHaveLength(0);
      expect(lastResolveAuthOptions?.allowGuestPreview).toBe(false);
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
    }
  });

  it("does not refund duplicate spends on worker failure", async () => {
    nextSpendResult = {
      ok: true,
      ledgerId: "nle_existing",
      balanceBefore: 10,
      balanceAfter: 9,
      duplicate: true,
    };
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
    expect(lastSpendInputs).toHaveLength(1);
    expect(lastRefundInputs).toHaveLength(0);
  });
});
