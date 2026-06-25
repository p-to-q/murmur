import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";
import type {
  BalanceResult,
  RefundNotesInput,
  SpendNotesInput,
  SpendNotesResult,
} from "@/lib/db/queries/notes-ledger";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";
import type { TranscriptionResult } from "@/modules/shared/types";

let nextAuth: ResolvedRequestAuth = {
  ok: true,
  user: { id: "usr_capture", email: null, name: "Capture", avatarUrl: null },
  source: "session",
  sessionId: "sess_capture",
};
let nextBalance: BalanceResult = {
  ok: true,
  userId: "usr_capture",
  notes: 10,
  accountNotes: 10,
  dailyFreeNotes: 0,
  planTier: "free",
  freeNotesGrantedAt: new Date(),
};
let nextSpendResult: SpendNotesResult = {
  ok: true,
  ledgerId: "nle_capture",
  balanceBefore: 10,
  balanceAfter: 9,
  duplicate: false,
};
let nextSpeechProvider: null | { transcribeSpeech: (audio: File) => Promise<unknown> } = null;
let nextClassification: { kind: "hum" | "voice"; [key: string]: unknown } = {
  kind: "hum",
};
let nextTranscriptionResult: TranscriptionResult | null = null;
let nextWorkerThrows: Error | null = null;
const lastSpendInputs: SpendNotesInput[] = [];
const lastRefundInputs: RefundNotesInput[] = [];

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

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async () => nextAuth,
}));

mock.module("@/lib/db/queries/notes-ledger", () => ({
  getNotesBalance: async () => nextBalance,
  spendNotes: async (input: SpendNotesInput) => {
    lastSpendInputs.push(input);
    return nextSpendResult;
  },
  refundNotes: async (input: RefundNotesInput) => {
    lastRefundInputs.push(input);
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

mock.module("@/lib/platform/audio-worker", () => ({
  AudioWorkerError: TestAudioWorkerError,
  transcribeWithAudioWorker: async () => {
    if (nextWorkerThrows) throw nextWorkerThrows;
    if (!nextTranscriptionResult) {
      throw new Error("test forgot to set nextTranscriptionResult");
    }
    return nextTranscriptionResult;
  },
  isInstrumentId: (value: string) => value === "piano",
  isMelodyCarrier: (value: string) => value === "piano",
}));

mock.module("@/lib/platform/speech-recognition", () => ({
  getSpeechRecognitionProvider: () => nextSpeechProvider,
  classifySpeechTranscription: () => nextClassification,
  SpeechRecognitionError: class extends Error {
    readonly code = "provider_http_error";
    readonly status = 502;
  },
}));

const { POST } = await import("./route");

function buildRequest(
  requestId: string,
  bytes = 128,
): NextRequest {
  const form = new FormData();
  form.append("audio", new File([new Uint8Array(bytes)], "capture.webm", { type: "audio/webm" }));
  form.append("targetInstrument", "piano");
  return new Request("http://test.local/api/capture/analyze", {
    method: "POST",
    headers: { "x-request-id": requestId },
    body: form,
  }) as unknown as NextRequest;
}

beforeEach(() => {
  nextAuth = {
    ok: true,
    user: { id: "usr_capture", email: null, name: "Capture", avatarUrl: null },
    source: "session",
    sessionId: "sess_capture",
  };
  nextBalance = {
    ok: true,
    userId: "usr_capture",
    notes: 10,
    accountNotes: 10,
    dailyFreeNotes: 0,
    planTier: "free",
    freeNotesGrantedAt: new Date(),
  };
  nextSpendResult = {
    ok: true,
    ledgerId: "nle_capture",
    balanceBefore: 10,
    balanceAfter: 9,
    duplicate: false,
  };
  nextSpeechProvider = null;
  nextClassification = { kind: "hum" };
  nextTranscriptionResult = {
    provider: "swiftf0",
    rawNotes: [
      { pitch: 64, start: 0, duration: 0.4, velocity: 0.7, confidence: 0.9 },
    ],
    melodies: {
      intent: {
        notes: [
          { pitch: 64, start: 0, duration: 0.4, velocity: 0.7, confidence: 0.9 },
        ],
        key: "C",
        scale: "major",
        bpm: 120,
        duration: 0.4,
        contour: "flat",
      },
      corrected: {
        notes: [
          { pitch: 64, start: 0, duration: 0.4, velocity: 0.7, confidence: 0.9 },
        ],
        key: "C",
        scale: "major",
        bpm: 120,
        duration: 0.4,
        contour: "flat",
      },
      musical: {
        notes: [
          { pitch: 64, start: 0, duration: 0.4, velocity: 0.7, confidence: 0.9 },
        ],
        key: "C",
        scale: "major",
        bpm: 120,
        duration: 0.4,
        contour: "flat",
      },
    },
    selectedMelodyKind: "corrected",
    cleanMelody: {
      notes: [
        { pitch: 64, start: 0, duration: 0.4, velocity: 0.7, confidence: 0.9 },
      ],
      key: "C",
      scale: "major",
      bpm: 120,
      duration: 0.4,
      contour: "flat",
    },
    warnings: [],
    diagnostics: {
      duration: 0.4,
      snr: 20,
      voicedRatio: 0.8,
      targetInstrument: "piano",
      rangeClampApplied: false,
    },
  };
  nextWorkerThrows = null;
  lastSpendInputs.length = 0;
  lastRefundInputs.length = 0;
});

describe("POST /api/capture/analyze", () => {
  it("routes lyrical singing to voice and skips hum transcription", async () => {
    nextSpeechProvider = {
      transcribeSpeech: async () => ({
        text: "I can sing this line",
        language: "en",
        confidence: 0.94,
        provider: "local:sensevoice:SenseVoiceSmall-GGUF",
      }),
    };
    nextClassification = {
      kind: "voice",
      lyrics: "I can sing this line",
      language: "en",
      confidence: 0.93,
      diagnostics: {
        provider: "local:sensevoice:SenseVoiceSmall-GGUF",
        textLength: 21,
        tokenCount: 5,
        lexicalTokenCount: 5,
        lyricTokenRatio: 1,
        repeatedSyllableRatio: 0,
        language: "en",
        asrConfidence: 0.94,
        reason: "lyrical_speech_detected",
      },
    };

    const response = await POST(buildRequest("req_voice"));
    expect(response.status).toBe(200);
    const body = await response.json() as {
      kind: "voice";
      lyrics: string;
      language: string;
      confidence: number;
    };
    expect(body.kind).toBe("voice");
    expect(body.lyrics).toContain("sing");
    expect(body.language).toBe("en");
    expect(lastSpendInputs).toHaveLength(0);
  });

  it("keeps hum on the audio-worker path and spends hum notes", async () => {
    nextSpeechProvider = {
      transcribeSpeech: async () => ({
        text: "la la la",
        language: "unknown",
        confidence: 0.72,
        provider: "local:sensevoice:SenseVoiceSmall-GGUF",
      }),
    };
    nextClassification = {
      kind: "hum",
      confidence: 0.62,
      diagnostics: {
        provider: "local:sensevoice:SenseVoiceSmall-GGUF",
        textLength: 8,
        tokenCount: 3,
        lexicalTokenCount: 0,
        lyricTokenRatio: 0,
        repeatedSyllableRatio: 1,
        language: "unknown",
        asrConfidence: 0.72,
        reason: "ambiguous_or_non_lyrical",
      },
    };

    const response = await POST(buildRequest("req_hum"));
    expect(response.status).toBe(200);
    const body = await response.json() as { kind: "hum"; transcription: TranscriptionResult };
    expect(body.kind).toBe("hum");
    expect(body.transcription.cleanMelody.notes).toHaveLength(1);
    expect(lastSpendInputs).toHaveLength(1);
    expect(lastSpendInputs[0]?.reason).toBe("spend:hum");
  });
});
