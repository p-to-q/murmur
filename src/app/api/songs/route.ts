import { NextRequest, NextResponse } from "next/server";
import { resolveRequestAuth } from "@/lib/auth";
import { getSongsByUser, createSongWithSpend } from "@/lib/db/queries/songs";
import { log } from "@/lib/observability/log";
import { COST } from "@murmur/core";

const ROUTE = "/api/songs";

export async function GET(req: NextRequest) {
  const auth = await resolveRequestAuth(req);
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;
  try {
    const rows = await getSongsByUser(userId);
    return NextResponse.json(rows);
  } catch (err) {
    if (userId === "guest" && isDatabaseUnavailable(err)) {
      log("song.list_failed", {
        reason: "database_unavailable",
        fallback: "guest_empty_gallery",
      }, {
        route: "/api/songs",
        userId,
        sessionId: auth.sessionId,
        level: "warn",
      });
      return NextResponse.json([]);
    }

    console.error("[songs GET]", err);
    return NextResponse.json({ error: "Failed to fetch songs" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const auth = await resolveRequestAuth(req);
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;
  try {
    const body = await req.json();
    const result = await createSongWithSpend(
      { ...body, userId },
      {
        cost: COST.save,
        externalRef: requestId,
        metadata: {
          title: typeof body.title === "string" ? body.title.slice(0, 80) : null,
        },
      },
    );

    if (!result.ok) {
      if (result.reason === "insufficient_notes") {
        return NextResponse.json(
          {
            error: "insufficient_notes",
            message: "Not enough Murmur Notes",
            currentBalance: result.currentBalance,
            cost: COST.save,
            requestId,
          },
          { status: 402, headers: { "X-Request-Id": requestId } },
        );
      }

      return NextResponse.json(
        {
          error: "billing_unavailable",
          message: "User balance is unavailable",
          requestId,
        },
        { status: 503, headers: { "X-Request-Id": requestId } },
      );
    }

    log("notes.spent", {
      reason: "spend:save",
      cost: COST.save,
      balanceAfter: result.spend.balanceAfter,
      ledgerId: result.spend.ledgerId,
    }, {
      route: ROUTE,
      requestId,
      userId,
      sessionId: auth.sessionId,
    });
    log("song.created", {
      songId: result.song.id,
      cost: COST.save,
      balanceAfter: result.spend.balanceAfter,
    }, {
      route: ROUTE,
      requestId,
      userId,
      sessionId: auth.sessionId,
    });

    return NextResponse.json(result.song, {
      headers: { "X-Request-Id": requestId },
    });
  } catch (err) {
    console.error("[songs POST]", err);
    if (isDatabaseUnavailable(err)) {
      return NextResponse.json(
        { error: "billing_unavailable", message: "Database unavailable", requestId },
        { status: 503, headers: { "X-Request-Id": requestId } },
      );
    }

    return NextResponse.json(
      { error: "Failed to save song", requestId },
      { status: 500, headers: { "X-Request-Id": requestId } },
    );
  }
}

function isDatabaseUnavailable(error: unknown): boolean {
  if (!isObject(error)) return false;

  const code = "code" in error ? error.code : null;
  if (code === "ECONNREFUSED") return true;

  const message = "message" in error ? String(error.message) : "";
  if (message.includes("ECONNREFUSED") || message.includes("connection refused")) {
    return true;
  }

  const cause = "cause" in error ? error.cause : null;
  if (cause && isDatabaseUnavailable(cause)) return true;

  const nestedErrors = "errors" in error ? error.errors : null;
  if (Array.isArray(nestedErrors)) {
    return nestedErrors.some((nestedError) => isDatabaseUnavailable(nestedError));
  }

  return false;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
