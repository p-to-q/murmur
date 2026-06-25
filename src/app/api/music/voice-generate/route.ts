import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { resolveRequestAuth } from "@/lib/auth";
import { shouldAllowLocalPreviewFallback } from "@/lib/auth/local-preview";
import { shouldBypassBillingInDevelopment } from "@/lib/billing/dev-balance";
import { shouldSkipNotesBilling } from "@/lib/billing/session-billing";
import { getNotesBalance, refundNotes, spendNotes } from "@/lib/db/queries/notes-ledger";
import { clientIpFromHeaders } from "@/lib/http/client-ip";
import { log } from "@/lib/observability/log";
import { generateMiniMaxMusic, MiniMaxMusicError } from "@/lib/platform/minimax-music";
import { COST } from "@murmur/core";

export const runtime = "nodejs";
export const maxDuration = 300;

const ROUTE = "/api/music/voice-generate";
const RATE_LIMIT = { capacity: 4, refillWindowMs: 60_000 };

const payloadSchema = z.object({
  lyrics: z.string().trim().min(1).max(3500),
  stylePrompt: z.string().trim().min(1).max(2000),
  title: z.string().trim().max(160).optional(),
  draftId: z.string().trim().min(1).max(128).optional(),
});

type VoiceGenerateError =
  | "validation_error"
  | "insufficient_notes"
  | "billing_unavailable"
  | "provider_unconfigured"
  | "provider_http_error"
  | "provider_invalid_response"
  | "provider_generation_failed"
  | "audio_download_failed"
  | "storage_failed"
  | "server_error";

type SpendForRefund =
  | Extract<Awaited<ReturnType<typeof spendNotes>>, { ok: true }>
  | {
      ok: true;
      ledgerId: null;
      balanceBefore: null;
      balanceAfter: null;
      duplicate: false;
    };

export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  const auth = await resolveRequestAuth(request, {
    allowGuestPreview: shouldAllowLocalPreviewFallback(request),
  });
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;
  let spendForRefund: SpendForRefund | null = null;

  const rateLimitId =
    auth.source === "guest"
      ? `${userId}:${clientIpFromHeaders(request.headers)}`
      : userId;
  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "user",
    userId: rateLimitId,
    requestId,
    sessionId: auth.sessionId,
    options: RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit, requestId);
  }

  let body: z.infer<typeof payloadSchema>;
  try {
    body = payloadSchema.parse(await request.json());
  } catch (error) {
    return fail("validation_error", "Invalid voice generation payload", 400, {
      requestId,
      userId,
      startedAt,
      ext: error instanceof z.ZodError ? { issues: error.issues } : undefined,
    });
  }

  const billing = await prepareBilling({
    request,
    auth,
    userId,
    requestId,
    sessionId: auth.sessionId,
    startedAt,
    lyricsLength: body.lyrics.length,
    promptLength: body.stylePrompt.length,
  });
  if (!billing.ok) return billing.response;
  spendForRefund = billing.spend;

  try {
    const songId = body.draftId || crypto.randomUUID();
    const result = await generateMiniMaxMusic({
      lyrics: body.lyrics,
      prompt: body.stylePrompt,
      title: body.title,
      userId,
      songId,
      requestId,
    });

    log("voice.generate_completed", {
      cost: COST.voice_generate,
      balanceAfter: billing.spend.balanceAfter,
      billingMode: billing.billingMode,
      providerModel: result.providerModel,
      bytes: result.bytes,
      durationSec: result.durationSec,
    }, {
      route: ROUTE,
      requestId,
      userId,
      sessionId: auth.sessionId,
      durationMs: Math.round(performance.now() - startedAt),
    });

    return NextResponse.json(
      {
        mp3Url: result.mp3Url,
        audioObjectKey: result.audioObjectKey,
        providerModel: result.providerModel,
        durationSec: result.durationSec,
        contentType: result.contentType,
      },
      { headers: { "X-Request-Id": requestId } },
    );
  } catch (error) {
    const trigger = error instanceof MiniMaxMusicError ? error.code : "server_error";
    const refunded = await refundSpendIfNeeded({
      spend: spendForRefund,
      requestId,
      userId,
      sessionId: auth.sessionId,
      trigger,
    });
    spendForRefund = null;
    if (!refunded) {
      return fail("billing_unavailable", "Voice generation refund failed", 500, {
        requestId,
        userId,
        startedAt,
        ext: { trigger },
      });
    }
    if (error instanceof MiniMaxMusicError) {
      return fail(error.code, error.message, error.status, {
        requestId,
        userId,
        startedAt,
        ext: { detail: error.detail },
      });
    }
    return fail("server_error", "Voice generation failed", 500, {
      requestId,
      userId,
      startedAt,
      ext: { message: error instanceof Error ? error.message : String(error) },
    });
  }
}

async function prepareBilling(options: {
  request: NextRequest;
  auth: Extract<Awaited<ReturnType<typeof resolveRequestAuth>>, { ok: true }>;
  userId: string;
  requestId: string;
  sessionId: string | null;
  startedAt: number;
  lyricsLength: number;
  promptLength: number;
}): Promise<
  | {
      ok: true;
      spend: SpendForRefund;
      billingMode: "ledger" | "dev_fallback";
    }
  | { ok: false; response: NextResponse }
> {
  if (
    shouldSkipNotesBilling(options.auth) ||
    shouldBypassVoiceBillingForLocalDemo(options.request, options.auth)
  ) {
    return {
      ok: true,
      spend: {
        ok: true,
        ledgerId: null,
        balanceBefore: null,
        balanceAfter: null,
        duplicate: false,
      },
      billingMode: "dev_fallback",
    };
  }

  const balance = await getNotesBalance(options.userId).catch(() => null);
  if (!balance?.ok) {
    return {
      ok: false,
      response: fail("billing_unavailable", "User balance is unavailable", 503, {
        requestId: options.requestId,
        userId: options.userId,
        startedAt: options.startedAt,
      }),
    };
  }
  if (balance.notes < COST.voice_generate) {
    return {
      ok: false,
      response: fail("insufficient_notes", "Not enough Murmur Notes", 402, {
        requestId: options.requestId,
        userId: options.userId,
        startedAt: options.startedAt,
        body: { currentBalance: balance.notes, cost: COST.voice_generate },
        ext: { currentBalance: balance.notes, cost: COST.voice_generate },
      }),
    };
  }

  const spend = await spendNotes({
    userId: options.userId,
    cost: COST.voice_generate,
    reason: "spend:voice_generate",
    externalRef: `voice_generate:${options.requestId}`,
    metadata: {
      requestId: options.requestId,
      route: ROUTE,
      lyricsLength: options.lyricsLength,
      promptLength: options.promptLength,
    },
  }).catch(() => null);

  if (!spend?.ok) {
    return {
      ok: false,
      response: fail(
        spend?.reason === "insufficient_notes" ? "insufficient_notes" : "billing_unavailable",
        spend?.reason === "insufficient_notes" ? "Not enough Murmur Notes" : "Could not spend Murmur Notes",
        spend?.reason === "insufficient_notes" ? 402 : 503,
        {
          requestId: options.requestId,
          userId: options.userId,
          startedAt: options.startedAt,
          body:
            spend?.reason === "insufficient_notes"
              ? { currentBalance: spend.currentBalance, cost: COST.voice_generate }
              : undefined,
        },
      ),
    };
  }

  return { ok: true, spend, billingMode: "ledger" };
}

function shouldBypassVoiceBillingForLocalDemo(
  request: NextRequest,
  auth: Extract<Awaited<ReturnType<typeof resolveRequestAuth>>, { ok: true }>,
): boolean {
  if (auth.user.accountKind === "local_creator") return false;
  const host = request.nextUrl?.hostname || safeHostnameFromUrl(request.url);
  return shouldBypassBillingInDevelopment({ host });
}

async function refundSpendIfNeeded(options: {
  spend: SpendForRefund | null;
  requestId: string;
  userId: string;
  sessionId: string | null;
  trigger: string;
}): Promise<boolean> {
  if (!options.spend || options.spend.ledgerId === null || options.spend.duplicate) {
    return true;
  }

  try {
    const refund = await refundNotes({
      originalLedgerId: options.spend.ledgerId,
      metadata: {
        requestId: options.requestId,
        trigger: options.trigger,
      },
    });
    if (refund.ok) return true;
    log("notes.refund_failed", {
      requestLedgerId: options.spend.ledgerId,
      reason: refund.reason,
    }, {
      route: ROUTE,
      requestId: options.requestId,
      userId: options.userId,
      sessionId: options.sessionId,
      level: "error",
    });
    return false;
  } catch (error) {
    log("notes.refund_failed", {
      requestLedgerId: options.spend.ledgerId,
      reason: error instanceof Error ? error.message : String(error),
    }, {
      route: ROUTE,
      requestId: options.requestId,
      userId: options.userId,
      sessionId: options.sessionId,
      level: "error",
    });
    return false;
  }
}

function safeHostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function fail(
  error: VoiceGenerateError,
  message: string,
  status: number,
  options: {
    requestId: string;
    userId: string;
    startedAt: number;
    body?: Record<string, unknown>;
    ext?: Record<string, unknown>;
  },
) {
  log("voice.generate_failed", {
    error_code: error,
    ...options.ext,
  }, {
    route: ROUTE,
    requestId: options.requestId,
    userId: options.userId,
    durationMs: Math.round(performance.now() - options.startedAt),
    level: status >= 500 ? "error" : "warn",
  });

  return NextResponse.json(
    { error, message, requestId: options.requestId, ...options.body },
    { status, headers: { "X-Request-Id": options.requestId } },
  );
}
