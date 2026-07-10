import { NextRequest, NextResponse } from "next/server";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { resolveRequestAuth } from "@/lib/auth";
import { shouldBypassBillingInDevelopment } from "@/lib/billing/dev-balance";
import { shouldSkipNotesBilling } from "@/lib/billing/session-billing";
import { getNotesBalance, refundNotes, spendNotes } from "@/lib/db/queries/notes-ledger";
import { log } from "@/lib/observability/log";
import { checkBudget } from "@/lib/observability/latency-budgets";
import { ai } from "@/lib/platform/ai-server";
import { type EditToken, ALL_EDIT_TOKENS } from "@/modules/strummer/apply-edit";
import { STRUMMER_EDIT_SYSTEM_PROMPT } from "@/modules/strummer/edit-system-prompt";
import { COST } from "@murmur/core";

// Strummer prompt → EditToken classifier.
//
// We ask deepseek to choose at most 3 tokens from an explicit allowlist; we
// validate the JSON response against ALL_EDIT_TOKENS before returning, so the
// model can never push an unsanctioned mutation through the Studio UI. The
// client falls back to the rule-based parser when this endpoint is unavailable.

const TIMEOUT_MS = 8_000;
const ROUTE = "/api/strummer/edit";
const STRUMMER_EDIT_RATE_LIMIT = { capacity: 10, refillWindowMs: 60_000 };

type RequestBody = { prompt?: string };

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const spendRef = createSpendReference("llm_edit");
  const auth = await resolveRequestAuth(req);
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;
  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "user",
    userId,
    requestId,
    sessionId: auth.sessionId,
    options: STRUMMER_EDIT_RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit, requestId);
  }
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", requestId },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  const prompt = (body.prompt ?? "").trim().slice(0, 280);
  if (!prompt) {
    return NextResponse.json(
      { error: "Empty prompt", requestId },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }
  if (!process.env.OPENAI_API_KEY && !process.env.AI_GATEWAY_API_KEY) {
    // Without a key configured we deterministically refuse, so the client
    // knows to fall back to the rule parser.
    return NextResponse.json(
      { tokens: [], reason: "LLM disabled", requestId },
      { status: 503, headers: { "X-Request-Id": requestId } },
    );
  }

  let balance: Awaited<ReturnType<typeof getNotesBalance>>;
  try {
    balance = await getNotesBalance(userId);
  } catch (error) {
    return NextResponse.json(
      {
        error: "billing_unavailable",
        message: error instanceof Error ? error.message : "User balance is unavailable",
        requestId,
      },
      { status: 503, headers: { "X-Request-Id": requestId } },
    );
  }

  if (!balance.ok) {
    return NextResponse.json(
      { error: "billing_unavailable", message: "User balance is unavailable", requestId },
      { status: 503, headers: { "X-Request-Id": requestId } },
    );
  }
  if (
    !shouldSkipNotesBilling(auth)
    && !shouldBypassBillingInDevelopment({ host: req.nextUrl?.hostname })
    && balance.notes < COST.llm_edit
  ) {
    return NextResponse.json(
      {
        error: "insufficient_notes",
        message: "Not enough Murmur Notes",
        currentBalance: balance.notes,
        cost: COST.llm_edit,
        requestId,
      },
      { status: 402, headers: { "X-Request-Id": requestId } },
    );
  }

  let spend:
    | Awaited<ReturnType<typeof spendNotes>>
    | {
        ok: true;
        ledgerId: null;
        balanceBefore: null;
        balanceAfter: null;
        duplicate: false;
      };
  if (shouldBypassBillingInDevelopment({ host: req.nextUrl?.hostname }) || shouldSkipNotesBilling(auth)) {
    spend = {
      ok: true,
      ledgerId: null,
      balanceBefore: null,
      balanceAfter: null,
      duplicate: false,
    };
  } else {
    try {
      spend = await spendNotes({
        userId,
        cost: COST.llm_edit,
        reason: "spend:llm_edit",
        externalRef: spendRef,
        metadata: {
          requestId,
          promptLength: prompt.length,
          route: ROUTE,
          phase: "preflight",
        },
      });
    } catch (error) {
      return NextResponse.json(
        {
          error: "billing_unavailable",
          message: error instanceof Error ? error.message : "Could not spend Murmur Notes",
          requestId,
        },
        { status: 503, headers: { "X-Request-Id": requestId } },
      );
    }

    if (!spend.ok) {
      if (spend.reason === "user_not_found") {
        return NextResponse.json(
          { error: "billing_unavailable", message: "User balance is unavailable", requestId },
          { status: 503, headers: { "X-Request-Id": requestId } },
        );
      }

      return NextResponse.json(
        {
          error: "insufficient_notes",
          message: "Not enough Murmur Notes",
          currentBalance: spend.currentBalance,
          cost: COST.llm_edit,
          requestId,
        },
        { status: 402, headers: { "X-Request-Id": requestId } },
      );
    }

    if (!spend.duplicate) {
      log("notes.spent", {
        reason: "spend:llm_edit",
        cost: COST.llm_edit,
        balanceAfter: spend.balanceAfter,
        ledgerId: spend.ledgerId,
      }, {
        route: ROUTE,
        requestId,
        userId,
        sessionId: auth.sessionId,
      });
    }
  }

  try {
    // Budget clock starts here: `llm_edit` measures the LLM call itself, not
    // auth/rate-limit/billing overhead, so budget_exceeded flags the component
    // that actually regressed.
    const llmStartedAt = performance.now();
    const completion = await Promise.race([
      ai.chat({
        model: "deepseek.v3.1",
        messages: [
          { role: "system", content: STRUMMER_EDIT_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 200,
      }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("LLM timeout")), TIMEOUT_MS)
      ),
    ]);

    const text = completion.choices[0]?.message?.content ?? "";
    const tokens = extractTokens(text);
    const editDurationMs = Math.round(performance.now() - llmStartedAt);
    const editBudget = checkBudget("llm_edit", editDurationMs);
    if (editBudget.budget_exceeded) {
      log("strummer.edit_completed", {
        budget_exceeded: true,
        budget_p95: editBudget.budget_p95,
        tokenCount: tokens.length,
      }, {
        route: ROUTE,
        requestId,
        userId,
        durationMs: editDurationMs,
        level: "warn",
      });
    }

    return NextResponse.json(
      { tokens, raw: text.slice(0, 400), requestId },
      { headers: { "X-Request-Id": requestId } },
    );
  } catch (err) {
    await refundStrummerSpendIfNeeded({
      spend,
      requestId,
      userId,
      sessionId: auth.sessionId,
      promptLength: prompt.length,
    });
    console.warn("[strummer/edit] llm failed:", err);
    return NextResponse.json(
      { tokens: [], error: err instanceof Error ? err.message : "LLM error", requestId },
      { status: 502, headers: { "X-Request-Id": requestId } },
    );
  }
}

async function refundStrummerSpendIfNeeded(options: {
  spend:
    | Awaited<ReturnType<typeof spendNotes>>
    | {
        ok: true;
        ledgerId: null;
        balanceBefore: null;
        balanceAfter: null;
        duplicate: false;
      };
  requestId: string;
  userId: string;
  sessionId: string | null;
  promptLength: number;
}): Promise<void> {
  if (!options.spend.ok) return;
  if (options.spend.ledgerId === null || options.spend.duplicate) return;

  try {
    const refund = await refundNotes({
      originalLedgerId: options.spend.ledgerId,
      metadata: {
        requestId: options.requestId,
        promptLength: options.promptLength,
        trigger: "strummer_llm_failed",
      },
    });

    if (refund.ok) {
      if (!refund.duplicate) {
        log("notes.granted", {
          reason: "refund:spend",
          delta: refund.amount,
          balanceAfter: refund.balanceAfter,
          originalLedgerId: refund.originalLedgerId,
          refundLedgerId: refund.refundLedgerId,
        }, {
          route: ROUTE,
          requestId: options.requestId,
          userId: options.userId,
          sessionId: options.sessionId,
          level: "warn",
        });
      }
      return;
    }

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
  }
}

// Best-effort JSON extraction — accepts either a clean JSON blob or a markdown
// fenced block. Filters tokens against the allowlist so callers never see an
// unknown value.
function extractTokens(text: string): EditToken[] {
  if (!text) return [];
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonish = fenceMatch?.[1] ?? text;

  const firstBrace = jsonish.indexOf("{");
  const lastBrace = jsonish.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonish.slice(firstBrace, lastBrace + 1));
  } catch {
    return [];
  }

  const arr = (parsed as { tokens?: unknown }).tokens;
  if (!Array.isArray(arr)) return [];

  const allow = new Set(ALL_EDIT_TOKENS);
  return arr
    .filter((v): v is string => typeof v === "string")
    .filter((v): v is EditToken => allow.has(v as EditToken))
    .slice(0, 3);
}

function createSpendReference(kind: "llm_edit"): string {
  return `${kind}:${crypto.randomUUID()}`;
}
