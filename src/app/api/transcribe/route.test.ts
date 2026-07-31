import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import type {
  RefundNotesInput,
  SpendNotesInput,
  SpendNotesResult,
} from "@/lib/db/queries/notes-ledger";
import { getRateLimitStore, resetCachedRateLimitStore } from "@/lib/rate-limit";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";
import { setTestNodeEnv } from "@/test-utils/env";
import type { TranscriptionResult } from "@/modules/shared/types";

// State each test case mutates before invoking the route. Module mocks
// below read these closures, so tests stay declarative.
let nextAuth: ResolvedRequestAuth = {
  ok: true,
  user: { id: "usr_test", email: null, name: "Test User", avatarUrl: null },
  source: "guest",
  sessionId: null,
};
let nextSpendResult: SpendNotesResult = {
  ok: true,
  ledgerId: "nle_test",
  balanceBefore: 10,
  balanceAfter: 9,
  duplicate: false,
};
let nextSpendThrows: Error | null = null;
let nextRefundThrows: Error | null = null;
let nextRefundResult: { ok: false; reason: string } | null = null;
let nextWorkerImpl: (() => Promise<TranscriptionResult>) | null = null;
let nextOperationPreparation:
  | "proceed"
  | "replay"
  | "result_ready"
  | "idempotency_conflict"
  | "operation_in_progress" = "proceed";
let nextOperationRecordResult = true;
let nextOperationReleaseResult = true;
let nextOperationSettleResult: "ok" | "insufficient_notes" | "billing_unavailable" = "ok";
const recordedOperationResults: Array<{ operationId: string; leaseEpoch: number }> = [];
const releasedOperationAttempts: Array<{ operationId: string; leaseEpoch: number }> = [];
const lastSpendInputs: SpendNotesInput[] = [];
const lastRefundInputs: RefundNotesInput[] = [];
const lastPendingRefundInputs: Array<{ userId: string; originalLedgerId: string }> = [];
const lastSettleInputs: Array<{ userId: string; spendLedgerId: string }> = [];
let nextSettleResult: {
  ok: true;
  state: string;
  delivered: boolean;
  recharged: boolean;
  duplicate: boolean;
  rechargeLedgerId: string | null;
  balanceAfter: number;
} = {
  ok: true,
  state: "delivered",
  delivered: true,
  recharged: false,
  duplicate: false,
  rechargeLedgerId: null,
  balanceAfter: 9,
};
let lastResolveAuthOptions: { allowGuestPreview?: boolean } | null = null;
const originalProductionPreview = process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW;
const originalVercel = process.env.VERCEL;

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
  spendNotes: async (input: SpendNotesInput) => {
    lastSpendInputs.push(input);
    if (nextSpendThrows) throw nextSpendThrows;
    return nextSpendResult;
  },
  refundNotes: async (input: RefundNotesInput) => {
    lastRefundInputs.push(input);
    if (nextRefundThrows) throw nextRefundThrows;
    if (nextRefundResult) return nextRefundResult;
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
  recordPendingRefund: async (input: { userId: string; originalLedgerId: string }) => {
    lastPendingRefundInputs.push(input);
    return {
      ok: true as const,
      pendingLedgerId: "nle_pending",
      externalRef: `refund_pending:${input.originalLedgerId}`,
      duplicate: false,
    };
  },
  settleOperationDelivery: async (input: { userId: string; spendLedgerId: string }) => {
    lastSettleInputs.push(input);
    return nextSettleResult;
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

mock.module("@/lib/platform/transcription-operation", () => ({
  prepareTranscriptionOperation: async (input: {
    operationId: string | null;
    requestId: string;
    bill: boolean;
  }) => {
    if (!input.operationId) {
      return { ok: true as const, kind: "legacy" as const, spend: null, balanceBefore: null, requestHash: null };
    }
    if (nextOperationPreparation === "idempotency_conflict" || nextOperationPreparation === "operation_in_progress") {
      return { ok: false as const, error: nextOperationPreparation, status: 409 };
    }
    if (nextOperationPreparation === "replay" || nextOperationPreparation === "result_ready") {
      return {
        ok: true as const,
        kind: nextOperationPreparation,
        result: stubTranscription,
        spendLedgerId: "nle_test",
      };
    }
    if (input.bill) {
      lastSpendInputs.push({
        userId: "usr_test",
        cost: 1,
        reason: "spend:hum",
        externalRef: `hum:op:${input.operationId}`,
        metadata: { requestId: input.requestId },
      });
    }
    return {
      ok: true as const,
      kind: "proceed" as const,
      spend: input.bill ? nextSpendResult : null,
      balanceBefore: input.bill && nextSpendResult.ok ? nextSpendResult.balanceBefore : null,
      requestHash: "a".repeat(64),
      charged: input.bill && nextSpendResult.ok && !nextSpendResult.duplicate,
      leaseEpoch: 0,
    };
  },
  recordTranscriptionResult: async (input: { operationId: string; leaseEpoch: number }) => {
    recordedOperationResults.push(input);
    return nextOperationRecordResult;
  },
  releaseTranscriptionAttempt: async (input: { operationId: string; leaseEpoch: number }) => {
    releasedOperationAttempts.push(input);
    return nextOperationReleaseResult;
  },
  settleRecordedTranscriptionOperation: async (input: { userId: string; spendLedgerId: string | null }) => {
    if (input.spendLedgerId) {
      lastSettleInputs.push({ userId: input.userId, spendLedgerId: input.spendLedgerId });
    }
    return nextOperationSettleResult === "ok"
      ? { ok: true as const }
      : { ok: false as const, reason: nextOperationSettleResult, currentBalance: 0 };
  },
}));

const { POST } = await import("./route");
const AudioWorkerError = TestAudioWorkerError;

function audioFile(bytes = 1024, type = "audio/webm"): File {
  return new File([new Uint8Array(bytes)], "hum.webm", { type });
}

function buildRequest(
  form: FormData,
  options: { requestId?: string; url?: string; operationId?: string } = {},
): NextRequest {
  const headers = new Headers();
  if (options.requestId) headers.set("x-request-id", options.requestId);
  if (options.operationId) headers.set("x-operation-id", options.operationId);
  return new Request(options.url ?? "http://test.local/api/transcribe", {
    method: "POST",
    body: form,
    headers,
  }) as unknown as NextRequest;
}

function buildStreamingRequest(
  form: FormData,
  options: { requestId?: string; signal?: AbortSignal; operationId?: string } = {},
): NextRequest {
  const headers = new Headers({ Accept: "text/x-ndjson" });
  if (options.requestId) headers.set("x-request-id", options.requestId);
  if (options.operationId) headers.set("x-operation-id", options.operationId);
  return new Request("http://test.local/api/transcribe", {
    method: "POST",
    body: form,
    headers,
    signal: options.signal,
  }) as unknown as NextRequest;
}

type StreamEvent = { phase: string; [key: string]: unknown };

async function drainNdjson(response: Response): Promise<StreamEvent[]> {
  const reader = response.body?.getReader();
  if (!reader) return [];
  const decoder = new TextDecoder();
  const events: StreamEvent[] = [];
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) events.push(JSON.parse(line) as StreamEvent);
    }
    if (done) break;
  }
  return events;
}

beforeEach(() => {
  delete process.env.MURMUR_RATE_LIMIT_DRIVER;
  delete process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW;
  delete process.env.VERCEL;
  resetCachedRateLimitStore();
  getRateLimitStore().resetAll();
  nextAuth = {
    ok: true,
    user: { id: "usr_test", email: null, name: "Test User", avatarUrl: null },
    source: "guest",
    sessionId: null,
  };
  nextSpendResult = {
    ok: true,
    ledgerId: "nle_test",
    balanceBefore: 10,
    balanceAfter: 9,
    duplicate: false,
  };
  nextSpendThrows = null;
  nextRefundThrows = null;
  nextRefundResult = null;
  nextWorkerImpl = async () => stubTranscription;
  nextOperationPreparation = "proceed";
  nextOperationRecordResult = true;
  nextOperationReleaseResult = true;
  nextOperationSettleResult = "ok";
  recordedOperationResults.length = 0;
  releasedOperationAttempts.length = 0;
  lastSpendInputs.length = 0;
  lastRefundInputs.length = 0;
  lastPendingRefundInputs.length = 0;
  lastSettleInputs.length = 0;
  nextSettleResult = {
    ok: true,
    state: "delivered",
    delivered: true,
    recharged: false,
    duplicate: false,
    rechargeLedgerId: null,
    balanceAfter: 9,
  };
  lastResolveAuthOptions = null;
});

afterEach(() => {
  restoreEnv("MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW", originalProductionPreview);
  restoreEnv("VERCEL", originalVercel);
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("POST /api/transcribe", () => {
  it("returns the polished melody and debits a note on success", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    setTestNodeEnv("production");
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
      setTestNodeEnv(prevNodeEnv);
    }
  });

  describe("operation settlement (#298)", () => {
    it("uses a stable spend ref and settles the operation on delivery when x-operation-id is present", async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      setTestNodeEnv("production");
      const form = new FormData();
      form.append("audio", audioFile());
      form.append("targetInstrument", "piano");

      try {
        const response = await POST(
          buildRequest(form, { requestId: "req_op", operationId: "op-abc-123" }),
        );
        expect(response.status).toBe(200);

        // Stable operation ref so a retry of the same operation dedupes.
        expect(lastSpendInputs[0]?.externalRef).toBe("hum:op:op-abc-123");
        // Delivery settled the operation with the spend's ledger id.
        expect(lastSettleInputs).toHaveLength(1);
        expect(lastSettleInputs[0]).toMatchObject({
          userId: "usr_test",
          spendLedgerId: "nle_test",
        });
      } finally {
        setTestNodeEnv(prevNodeEnv);
      }
    });

    it("preserves legacy behavior (random ref, no settlement) without x-operation-id", async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      setTestNodeEnv("production");
      const form = new FormData();
      form.append("audio", audioFile());
      form.append("targetInstrument", "piano");

      try {
        const response = await POST(buildRequest(form, { requestId: "req_legacy" }));
        expect(response.status).toBe(200);

        expect(lastSpendInputs[0]?.externalRef).toStartWith("hum:");
        expect(lastSpendInputs[0]?.externalRef).not.toStartWith("hum:op:");
        // No stable operation id → no operation settlement.
        expect(lastSettleInputs).toHaveLength(0);
      } finally {
        setTestNodeEnv(prevNodeEnv);
      }
    });

    it("ignores a malformed x-operation-id and falls back to legacy behavior", async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      setTestNodeEnv("production");
      const form = new FormData();
      form.append("audio", audioFile());
      form.append("targetInstrument", "piano");

      try {
        // Too short / contains illegal characters → rejected by isValidOperationId.
        await POST(buildRequest(form, { requestId: "req_bad", operationId: "bad id!" }));
        expect(lastSpendInputs[0]?.externalRef).not.toStartWith("hum:op:");
        expect(lastSettleInputs).toHaveLength(0);
      } finally {
        setTestNodeEnv(prevNodeEnv);
      }
    });

    it("does not settle on a worker failure (settlement is delivery-only)", async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      setTestNodeEnv("production");
      nextWorkerImpl = async () => {
        throw new AudioWorkerError("worker_http_error", "worker down", 502);
      };
      const form = new FormData();
      form.append("audio", audioFile());
      form.append("targetInstrument", "piano");

      try {
        const response = await POST(
          buildRequest(form, { requestId: "req_fail", operationId: "op-fail-1" }),
        );
        expect(response.status).toBe(502);
        // Failure → refund path, never delivery settlement.
        expect(lastSettleInputs).toHaveLength(0);
        expect(lastRefundInputs).toHaveLength(1);
      } finally {
        setTestNodeEnv(prevNodeEnv);
      }
    });

    it("settles the operation on the streaming delivery path", async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      setTestNodeEnv("production");
      const form = new FormData();
      form.append("audio", audioFile());
      form.append("targetInstrument", "piano");

      try {
        const response = await POST(
          buildStreamingRequest(form, { requestId: "req_op_stream", operationId: "op-stream-9" }),
        );
        const events = await drainNdjson(response);
        expect(events.at(-1)?.phase).toBe("complete");
        expect(lastSpendInputs[0]?.externalRef).toBe("hum:op:op-stream-9");
        expect(lastSettleInputs).toHaveLength(1);
        expect(lastSettleInputs[0]).toMatchObject({ spendLedgerId: "nle_test" });
      } finally {
        setTestNodeEnv(prevNodeEnv);
      }
    });

    it("replays an already-paid operation after its last Note was spent", async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      setTestNodeEnv("production");
      nextOperationPreparation = "replay";
      let workerCalls = 0;
      nextWorkerImpl = async () => {
        workerCalls += 1;
        return stubTranscription;
      };
      const form = new FormData();
      form.append("audio", audioFile());

      try {
        const response = await POST(buildRequest(form, {
          requestId: "req_empty_replay",
          operationId: "op-empty-replay",
        }));

        expect(response.status).toBe(200);
        expect(response.headers.get("X-Murmur-Operation-Replayed")).toBe("true");
        expect(lastSpendInputs).toHaveLength(0);
        expect(lastSettleInputs).toHaveLength(0);
        expect(workerCalls).toBe(0);
      } finally {
        setTestNodeEnv(prevNodeEnv);
      }
    });

    it("rejects a reused operation id when the request digest differs", async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      setTestNodeEnv("production");
      nextOperationPreparation = "idempotency_conflict";
      let workerCalls = 0;
      nextWorkerImpl = async () => {
        workerCalls += 1;
        return stubTranscription;
      };
      const form = new FormData();
      form.append("audio", audioFile(2048));

      try {
        const response = await POST(buildRequest(form, {
          requestId: "req_conflict",
          operationId: "op-input-conflict",
        }));
        expect(response.status).toBe(409);
        expect((await response.json()).error).toBe("idempotency_conflict");
        expect(workerCalls).toBe(0);
        expect(lastSpendInputs).toHaveLength(0);
      } finally {
        setTestNodeEnv(prevNodeEnv);
      }
    });

    it("releases the fenced attempt before refunding a failed worker", async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      setTestNodeEnv("production");
      nextWorkerImpl = async () => {
        throw new AudioWorkerError("worker_http_error", "worker down", 502);
      };
      const form = new FormData();
      form.append("audio", audioFile());

      try {
        const response = await POST(buildRequest(form, {
          requestId: "req_release_refund",
          operationId: "op-release-refund",
        }));
        expect(response.status).toBe(502);
        expect(releasedOperationAttempts).toEqual([
          expect.objectContaining({ operationId: "op-release-refund", leaseEpoch: 0 }),
        ]);
        expect(lastRefundInputs).toHaveLength(1);
      } finally {
        setTestNodeEnv(prevNodeEnv);
      }
    });

    it("does not refund when a newer attempt already owns the operation lease", async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      setTestNodeEnv("production");
      nextOperationReleaseResult = false;
      nextWorkerImpl = async () => {
        throw new AudioWorkerError("worker_http_error", "late worker failure", 502);
      };
      const form = new FormData();
      form.append("audio", audioFile());

      try {
        const response = await POST(buildRequest(form, {
          requestId: "req_stale",
          operationId: "op-stale-attempt",
        }));
        expect(response.status).toBe(502);
        expect(releasedOperationAttempts).toHaveLength(1);
        expect(lastRefundInputs).toHaveLength(0);
      } finally {
        setTestNodeEnv(prevNodeEnv);
      }
    });
  });

  it("does not reuse client request ids as spend idempotency keys", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    setTestNodeEnv("production");

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
      setTestNodeEnv(prevNodeEnv);
    }
  });

  it("allows RMVPE worker results through the stable transcribe route", async () => {
    const rmvpeResult: TranscriptionResult = {
      ...stubTranscription,
      provider: "rmvpe",
      diagnostics: {
        ...stubTranscription.diagnostics,
        duration: stubTranscription.diagnostics?.duration ?? stubTranscription.cleanMelody.duration,
        snr: stubTranscription.diagnostics?.snr ?? null,
        voicedRatio: stubTranscription.diagnostics?.voicedRatio ?? null,
        rmvpeFrames: 120,
        rmvpeVoicedFrames: 98,
      },
    };
    nextWorkerImpl = async () => rmvpeResult;
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

  it("spends Local Creator ledger notes in an explicitly enabled production preview", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    setTestNodeEnv("production");
    process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW = "1";
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
    const form = new FormData();
    form.append("audio", audioFile());

    try {
      const response = await POST(
        buildRequest(form, {
          requestId: "req_local_creator",
          url: "https://preview.example/api/transcribe",
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
    } finally {
      setTestNodeEnv(prevNodeEnv);
      delete process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW;
    }
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
    nextSpendResult = {
      ok: false,
      reason: "insufficient_notes",
      currentBalance: 0,
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
    expect(lastSpendInputs).toHaveLength(1);
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

  it("surfaces refund_pending (not the worker error) and records a durable marker when the refund also fails (#232)", async () => {
    nextRefundResult = { ok: false, reason: "original_not_found" };
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
    // Previously this masked the lost note behind the worker's 502.
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("refund_pending");
    expect(lastSpendInputs).toHaveLength(1);
    expect(lastRefundInputs).toHaveLength(1);
    // A durable marker was written for the reconcile cron to retry, keyed by the spend.
    expect(lastPendingRefundInputs).toHaveLength(1);
    expect(lastPendingRefundInputs[0]?.originalLedgerId).toBe("nle_test");
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
    setTestNodeEnv("development");
    process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = "1";
    nextSpendThrows = new Error("db offline");

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
      setTestNodeEnv(prevNodeEnv);
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
    setTestNodeEnv("development");
    process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = "1";
    nextSpendResult = {
      ok: false,
      reason: "insufficient_notes",
      currentBalance: 0,
    };

    try {
      const form = new FormData();
      form.append("audio", audioFile());
      const response = await POST(buildRequest(form, { requestId: "req_dev_unlimited" }));
      expect(response.status).toBe(200);
      expect(lastSpendInputs).toHaveLength(0);
      expect(lastRefundInputs).toHaveLength(0);
    } finally {
      setTestNodeEnv(prevNodeEnv);
      if (prevFlag === undefined) {
        delete process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK;
      } else {
        process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK = prevFlag;
      }
    }
  });

  it("rejects a forged localhost URL in non-Vercel production", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    setTestNodeEnv("production");
    delete process.env.VERCEL;
    delete process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW;
    nextSpendThrows = new Error("db offline");

    try {
      const form = new FormData();
      form.append("audio", audioFile());
      const response = await POST(
        buildRequest(form, {
          requestId: "req_non_vercel_localhost",
          url: "http://localhost:3000/api/transcribe",
        }),
      );
      expect(response.status).toBe(503);
      expect(lastResolveAuthOptions?.allowGuestPreview).toBe(false);
      expect(lastSpendInputs).toHaveLength(1);
      expect(lastRefundInputs).toHaveLength(0);
    } finally {
      setTestNodeEnv(prevNodeEnv);
    }
  });

  it("rejects a forged localhost URL in Vercel production", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    setTestNodeEnv("production");
    process.env.VERCEL = "1";
    delete process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW;
    nextSpendThrows = new Error("db offline");

    try {
      const form = new FormData();
      form.append("audio", audioFile());
      const response = await POST(
        buildRequest(form, {
          requestId: "req_vercel_localhost",
          url: "http://127.0.0.1:3000/api/transcribe",
        }),
      );
      expect(response.status).toBe(503);
      expect(lastResolveAuthOptions?.allowGuestPreview).toBe(false);
      expect(lastSpendInputs).toHaveLength(1);
      expect(lastRefundInputs).toHaveLength(0);
    } finally {
      setTestNodeEnv(prevNodeEnv);
      delete process.env.VERCEL;
    }
  });

  it("allows billing fallback only after explicit production opt-in", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    setTestNodeEnv("production");
    process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW = "1";
    nextSpendThrows = new Error("db offline");

    try {
      const form = new FormData();
      form.append("audio", audioFile());
      const response = await POST(
        buildRequest(form, {
          requestId: "req_explicit_production_preview",
          url: "https://preview.example/api/transcribe",
        }),
      );
      expect(response.status).toBe(200);
      expect(lastResolveAuthOptions?.allowGuestPreview).toBe(true);
      expect(lastSpendInputs).toHaveLength(0);
      expect(lastRefundInputs).toHaveLength(0);
    } finally {
      setTestNodeEnv(prevNodeEnv);
      delete process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW;
    }
  });

  it("respects the auth resolver returning a 401 envelope", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    setTestNodeEnv("production");
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
      setTestNodeEnv(prevNodeEnv);
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

  // --- Streaming (NDJSON) path (#206) ---

  it("streams progress events and returns the melody without refunding (happy path)", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    setTestNodeEnv("production");
    nextWorkerImpl = async () => stubTranscription;

    try {
      const form = new FormData();
      form.append("audio", audioFile());
      form.append("targetInstrument", "piano");
      const response = await POST(
        buildStreamingRequest(form, { requestId: "req_stream_ok" }),
      );
      expect(response.headers.get("Content-Type")).toContain("text/x-ndjson");

      const events = await drainNdjson(response);
      expect(events.map((e) => e.phase)).toEqual([
        "billing_ok",
        "worker_started",
        "complete",
      ]);
      const complete = events.find((e) => e.phase === "complete");
      expect((complete?.result as TranscriptionResult).provider).toBe("swiftf0");
      expect(lastSpendInputs).toHaveLength(1);
      expect(lastRefundInputs).toHaveLength(0);
    } finally {
      setTestNodeEnv(prevNodeEnv);
    }
  });

  it("refunds and emits an error event when the worker fails mid-stream", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    setTestNodeEnv("production");
    nextWorkerImpl = async () => {
      throw new AudioWorkerError("worker_http_error", "Audio worker unreachable", 502);
    };

    try {
      const form = new FormData();
      form.append("audio", audioFile());
      form.append("targetInstrument", "piano");
      const response = await POST(
        buildStreamingRequest(form, { requestId: "req_stream_err" }),
      );

      const events = await drainNdjson(response);
      const errorEvent = events.find((e) => e.phase === "error");
      expect(errorEvent?.error).toBe("worker_http_error");
      expect(errorEvent?.status).toBe(502);
      expect(lastSpendInputs).toHaveLength(1);
      expect(lastRefundInputs).toHaveLength(1);
      expect(lastRefundInputs[0]?.originalLedgerId).toBe("nle_test");
    } finally {
      setTestNodeEnv(prevNodeEnv);
    }
  });

  it("refunds the spent note exactly once when the client disconnects mid-stream (#206)", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    setTestNodeEnv("production");
    const abort = new AbortController();
    // Resolve `workerEntered` the moment the route reaches the worker call —
    // this is strictly after billing/spend — then hang forever so the client
    // disconnect wins the race deterministically (no fixed-delay flakiness).
    let workerEntered!: () => void;
    const workerReady = new Promise<void>((resolve) => {
      workerEntered = resolve;
    });
    nextWorkerImpl = () => {
      workerEntered();
      return new Promise<TranscriptionResult>(() => {
        /* never settles */
      });
    };

    try {
      const form = new FormData();
      form.append("audio", audioFile());
      form.append("targetInstrument", "piano");
      const response = await POST(
        buildStreamingRequest(form, {
          requestId: "req_disconnect",
          signal: abort.signal,
        }),
      );
      expect(response.headers.get("Content-Type")).toContain("text/x-ndjson");

      // Worker was entered => the note was already spent, nothing refunded yet.
      await workerReady;
      expect(lastSpendInputs).toHaveLength(1);
      expect(lastRefundInputs).toHaveLength(0);

      // Client goes away mid-stream. drainNdjson then blocks until the refund
      // completes and the route closes the stream, so the assertions below race
      // nothing.
      abort.abort();
      const events = await drainNdjson(response);

      const phases = events.map((e) => e.phase);
      expect(phases).toContain("billing_ok");
      expect(phases).toContain("worker_started");
      expect(phases).not.toContain("complete");
      // Exactly one refund: the disconnect branch and the (unreached) worker
      // branch are mutually exclusive, and refundNotes is idempotent by ledger.
      expect(lastRefundInputs).toHaveLength(1);
      expect(lastRefundInputs[0]?.originalLedgerId).toBe("nle_test");
    } finally {
      setTestNodeEnv(prevNodeEnv);
    }
  });

  it("emits refund_pending on the stream when the worker fails and the refund also fails (#232)", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    setTestNodeEnv("production");
    nextRefundResult = { ok: false, reason: "original_not_found" };
    nextWorkerImpl = async () => {
      throw new AudioWorkerError("worker_http_error", "Audio worker unreachable", 502);
    };

    try {
      const form = new FormData();
      form.append("audio", audioFile());
      form.append("targetInstrument", "piano");
      const response = await POST(
        buildStreamingRequest(form, { requestId: "req_stream_pending" }),
      );

      const events = await drainNdjson(response);
      const errorEvent = events.find((e) => e.phase === "error");
      expect(errorEvent?.error).toBe("refund_pending");
      expect(errorEvent?.status).toBe(500);
      expect(lastSpendInputs).toHaveLength(1);
      expect(lastRefundInputs).toHaveLength(1);
      // A durable marker was written for the reconcile cron to retry.
      expect(lastPendingRefundInputs).toHaveLength(1);
      expect(lastPendingRefundInputs[0]?.originalLedgerId).toBe("nle_test");
    } finally {
      setTestNodeEnv(prevNodeEnv);
    }
  });
});
