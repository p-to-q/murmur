import { beforeEach, describe, expect, it, mock } from "bun:test";
import type {
  BalanceResult,
  RefundNotesInput,
  RefundNotesResult,
  SpendNotesInput,
  SpendNotesResult,
} from "@/lib/db/queries/notes-ledger";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";
import type { MiniMaxMusicGenerateResult } from "@/lib/platform/minimax-music";
import type { NextRequest } from "next/server";

let nextAuth: ResolvedRequestAuth = {
  ok: true,
  user: { id: "usr_voice", email: null, name: "Voice", avatarUrl: null },
  source: "session",
  sessionId: "sess_voice",
};
let nextBalance: BalanceResult = {
  ok: true,
  userId: "usr_voice",
  notes: 10,
  accountNotes: 10,
  dailyFreeNotes: 0,
  planTier: "free",
  freeNotesGrantedAt: new Date(),
};
let nextSpendResult: SpendNotesResult = {
  ok: true,
  ledgerId: "nle_voice",
  balanceBefore: 10,
  balanceAfter: 6,
  duplicate: false,
};
let nextGenerateResult: MiniMaxMusicGenerateResult | null = null;
let nextGenerateThrows: Error | null = null;
let nextRefundResult: RefundNotesResult | null = null;
let nextRefundThrows: Error | null = null;
const lastSpendInputs: SpendNotesInput[] = [];
const lastRefundInputs: RefundNotesInput[] = [];
let lastResolveAuthOptions: { allowGuestPreview?: boolean } | null = null;

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async (_request: Request, options: { allowGuestPreview?: boolean } = {}) => {
    lastResolveAuthOptions = options;
    return nextAuth;
  },
}));

mock.module("@/lib/db/queries/notes-ledger", () => ({
  getNotesBalance: async () => nextBalance,
  spendNotes: async (input: SpendNotesInput) => {
    lastSpendInputs.push(input);
    return nextSpendResult;
  },
  refundNotes: async (input: RefundNotesInput) => {
    lastRefundInputs.push(input);
    if (nextRefundThrows) throw nextRefundThrows;
    if (nextRefundResult) return nextRefundResult;
    return {
      ok: true as const,
      refundLedgerId: "nle_voice_refund",
      originalLedgerId: input.originalLedgerId,
      balanceBefore: 6,
      balanceAfter: 10,
      amount: 4,
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

mock.module("@/lib/platform/minimax-music", () => ({
  generateMiniMaxMusic: async () => {
    if (nextGenerateThrows) throw nextGenerateThrows;
    if (!nextGenerateResult) {
      throw new Error("test forgot to set nextGenerateResult");
    }
    return nextGenerateResult;
  },
  MiniMaxMusicError: class extends Error {
    readonly code = "provider_http_error";
    readonly status = 502;
    readonly detail = null;
  },
}));

const { POST } = await import("./route");

function buildRequest(requestId: string): NextRequest {
  return buildRequestWithUrl("https://murmur.example/api/music/voice-generate", requestId);
}

function buildLocalPreviewRequest(requestId: string): NextRequest {
  return buildRequestWithUrl("http://localhost:3000/api/music/voice-generate", requestId);
}

function buildRequestWithUrl(url: string, requestId: string): NextRequest {
  return new Request(url, {
    method: "POST",
    headers: {
      "x-request-id": requestId,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      lyrics: "I can sing this line",
      stylePrompt: "warm intimate pop",
      title: "Voice Song",
      draftId: "draft_1",
    }),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  nextAuth = {
    ok: true,
    user: { id: "usr_voice", email: null, name: "Voice", avatarUrl: null },
    source: "session",
    sessionId: "sess_voice",
  };
  nextBalance = {
    ok: true,
    userId: "usr_voice",
    notes: 10,
    accountNotes: 10,
    dailyFreeNotes: 0,
    planTier: "free",
    freeNotesGrantedAt: new Date(),
  };
  nextSpendResult = {
    ok: true,
    ledgerId: "nle_voice",
    balanceBefore: 10,
    balanceAfter: 6,
    duplicate: false,
  };
  nextGenerateResult = {
    mp3Url: "https://cdn.example.com/song.mp3",
    audioObjectKey: "songs/master/usr_voice/song_1.mp3",
    providerModel: "minimax:music-2.6",
    contentType: "audio/mpeg",
    durationSec: 12,
    bytes: 321,
  };
  nextGenerateThrows = null;
  nextRefundResult = null;
  nextRefundThrows = null;
  lastSpendInputs.length = 0;
  lastRefundInputs.length = 0;
  lastResolveAuthOptions = null;
});

describe("POST /api/music/voice-generate", () => {
  it("spends notes and returns a stable mp3Url", async () => {
    const response = await POST(buildRequest("req_voice_ok"));
    expect(response.status).toBe(200);
    const body = await response.json() as {
      mp3Url: string;
      audioObjectKey: string;
      providerModel: string;
    };
    expect(body.mp3Url).toBe("https://cdn.example.com/song.mp3");
    expect(body.providerModel).toBe("minimax:music-2.6");
    expect(lastSpendInputs[0]?.reason).toBe("spend:voice_generate");
    expect(lastRefundInputs).toHaveLength(0);
    expect(lastResolveAuthOptions?.allowGuestPreview).toBe(false);
  });

  it("allows localhost preview without ledger billing for shared guests", async () => {
    nextAuth = {
      ok: true,
      user: { id: "guest", email: null, name: "Local Creator", avatarUrl: null },
      source: "guest",
      sessionId: null,
    };

    const response = await POST(buildLocalPreviewRequest("req_voice_local_preview"));

    expect(response.status).toBe(200);
    expect(lastResolveAuthOptions?.allowGuestPreview).toBe(true);
    expect(lastSpendInputs).toHaveLength(0);
    expect(lastRefundInputs).toHaveLength(0);
  });

  it("refunds the spend if generation throws", async () => {
    nextGenerateThrows = new Error("MiniMax exploded");
    const response = await POST(buildRequest("req_voice_fail"));
    expect(response.status).toBe(500);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("server_error");
    expect(lastSpendInputs).toHaveLength(1);
    expect(lastRefundInputs).toHaveLength(1);
    expect(lastRefundInputs[0]?.originalLedgerId).toBe("nle_voice");
  });
});
