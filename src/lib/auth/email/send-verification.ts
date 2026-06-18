import { Resend } from "resend";
import { ulid } from "ulid";
import { randomInt } from "crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { emailVerificationCodes } from "@/lib/db/schema/email-verification-codes";
import { normalizeEmail } from "@/lib/db/queries/users";

const CODE_EXPIRY_MINUTES = 10;
const MAX_ACTIVE_CODES_PER_EMAIL = 3;

export function isEmailAuthConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

function getResendClient(): Resend {
  return new Resend(process.env.RESEND_API_KEY!.trim());
}

function getFromEmail(): string {
  return process.env.RESEND_FROM_EMAIL?.trim() || "Murmur <noreply@murmur.ptoq.io>";
}

function generateCode(): string {
  return String(randomInt(100000, 1000000));
}

export async function sendVerificationCode(rawEmail: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  const email = normalizeEmail(rawEmail);

  const now = new Date();
  const activeCount = await db
    .select({ id: emailVerificationCodes.id })
    .from(emailVerificationCodes)
    .where(
      and(
        eq(emailVerificationCodes.email, email),
        gt(emailVerificationCodes.expiresAt, now),
        isNull(emailVerificationCodes.usedAt),
      ),
    );

  if (activeCount.length >= MAX_ACTIVE_CODES_PER_EMAIL) {
    return { ok: false, error: "rate_limit" };
  }

  const code = generateCode();
  const expiresAt = new Date(now.getTime() + CODE_EXPIRY_MINUTES * 60 * 1000);

  await db.insert(emailVerificationCodes).values({
    id: `evc_${ulid()}`,
    email,
    code,
    expiresAt,
  });

  try {
    const resend = getResendClient();
    await resend.emails.send({
      from: getFromEmail(),
      to: email,
      subject: `${code} is your Murmur verification code`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 400px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px; font-weight: 600; color: #1A1A1A; margin-bottom: 8px;">Murmur</h1>
          <p style="color: #8C8780; font-size: 14px; margin-bottom: 32px;">Your verification code</p>
          <div style="background: #F5F1EB; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
            <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #1A1A1A;">${code}</span>
          </div>
          <p style="color: #8C8780; font-size: 13px; line-height: 1.5;">
            This code expires in ${CODE_EXPIRY_MINUTES} minutes. If you didn't request this, you can safely ignore it.
          </p>
        </div>
      `,
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "send_failed" };
  }
}

const MAX_ATTEMPTS = 5;

export async function verifyCode(
  rawEmail: string,
  inputCode: string,
): Promise<{ ok: boolean; error?: string }> {
  const email = normalizeEmail(rawEmail);
  const code = inputCode.trim();
  const now = new Date();

  const activeCodes = await db
    .select()
    .from(emailVerificationCodes)
    .where(
      and(
        eq(emailVerificationCodes.email, email),
        gt(emailVerificationCodes.expiresAt, now),
        isNull(emailVerificationCodes.usedAt),
      ),
    )
    .orderBy(desc(emailVerificationCodes.createdAt));

  if (activeCodes.length === 0) return { ok: false, error: "invalid_code" };

  const latest = activeCodes[0];
  const totalAttempts = activeCodes.reduce((sum, c) => sum + c.attempts, 0);
  if (totalAttempts >= MAX_ATTEMPTS) return { ok: false, error: "max_attempts" };

  await db
    .update(emailVerificationCodes)
    .set({ attempts: latest.attempts + 1 })
    .where(eq(emailVerificationCodes.id, latest.id));

  const matched = activeCodes.find((c) => c.code === code);
  if (!matched) return { ok: false, error: "invalid_code" };

  await db
    .update(emailVerificationCodes)
    .set({ usedAt: now })
    .where(eq(emailVerificationCodes.id, matched.id));

  return { ok: true };
}
