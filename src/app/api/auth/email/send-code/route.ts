import { NextRequest, NextResponse } from "next/server";
import {
  sendVerificationCode,
  isEmailAuthConfigured,
} from "@/lib/auth/email/send-verification";
import { log } from "@/lib/observability/log";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  if (!isEmailAuthConfigured()) {
    return NextResponse.json(
      { error: "email_auth_disabled" },
      { status: 404 },
    );
  }

  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const email = body.email?.trim();
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const result = await sendVerificationCode(email);

  if (!result.ok) {
    log(
      "auth.email_send_code_failed",
      { error: result.error },
      { route: "/api/auth/email/send-code", level: "warn" },
    );
    const status = result.error === "rate_limit" ? 429 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }

  log(
    "auth.email_code_sent",
    {},
    { route: "/api/auth/email/send-code" },
  );

  return NextResponse.json({ ok: true });
}
