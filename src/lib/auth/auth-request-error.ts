import { readApiErrorEnvelope } from "@/lib/api/error-envelope";

/**
 * Stable client-facing error codes for the email login flow.
 *
 * Mirrors the `TranscribeRequestError` pattern in `src/lib/api/transcribe.ts`:
 * the login form switches on `.code` to pick recovery copy instead of
 * string-matching the raw server `error` field. Names track the codes emitted
 * by `POST /api/auth/email/send-code` and `POST /api/auth/email/verify-code`
 * (and the `sendVerificationCode` / `verifyCode` helpers behind them).
 *
 * `expired` is retained even though the current server collapses it into
 * `invalid_code`, because the form has stable copy for it and a future server
 * revision may surface it — keeping it typed avoids a silent regression.
 */
export type AuthRequestErrorCode =
  | "invalid_email"
  | "invalid_body"
  | "email_auth_disabled"
  | "rate_limit"
  | "send_failed"
  | "missing_fields"
  | "invalid_code"
  | "expired"
  | "max_attempts"
  | "verification_failed"
  | "server_error"
  | "network_error";

/**
 * Server `error` strings we recognize, mapped to the client code. Kept as an
 * explicit map (rather than an identity cast) so an unknown or rotated server
 * code degrades through `statusToFallbackCode` instead of leaking an untyped
 * string into the UI. The key set doubles as the known-code allowlist handed to
 * `readApiErrorEnvelope` for runtime validation at the boundary (#223).
 *
 * Only codes the auth routes actually emit belong here. `server_error` and
 * `network_error` are client-only terminal codes, so they are intentionally
 * absent: that makes the `"server_error"` fallback fall through to
 * `statusToFallbackCode`, preserving status-based recovery (e.g. a malformed
 * 429 still reads as `rate_limit`).
 */
const SERVER_ERROR_TO_CLIENT: Record<string, AuthRequestErrorCode> = {
  invalid_email: "invalid_email",
  invalid_body: "invalid_body",
  email_auth_disabled: "email_auth_disabled",
  rate_limit: "rate_limit",
  send_failed: "send_failed",
  missing_fields: "missing_fields",
  invalid_code: "invalid_code",
  expired: "expired",
  max_attempts: "max_attempts",
  verification_failed: "verification_failed",
};

const KNOWN_SERVER_CODES: ReadonlySet<string> = new Set(
  Object.keys(SERVER_ERROR_TO_CLIENT),
);

/**
 * Typed transport error for the email-login client helpers. The form switches
 * on `.code` for recovery copy; `.message` is diagnostic only and `.requestId`
 * feeds the AUTH support code shown in the error toast.
 */
export class AuthRequestError extends Error {
  readonly code: AuthRequestErrorCode;
  readonly status: number;
  readonly requestId: string | null;

  constructor(init: {
    code: AuthRequestErrorCode;
    message: string;
    status: number;
    requestId?: string | null;
  }) {
    super(init.message);
    this.name = "AuthRequestError";
    this.code = init.code;
    this.status = init.status;
    this.requestId = init.requestId ?? null;
  }
}

/**
 * Build a typed `AuthRequestError` from a non-2xx auth response. Routes the body
 * through the hardened shared envelope reader with the known-code allowlist, so
 * a malformed payload or an unrecognized error code degrades to `server_error`
 * (and is logged as `api.error_envelope_invalid`) instead of being trusted
 * (#223).
 */
export async function buildAuthRequestError(
  response: Response,
): Promise<AuthRequestError> {
  const envelope = await readApiErrorEnvelope(response, "server_error", {
    knownCodes: KNOWN_SERVER_CODES,
    area: "auth",
  });
  const code =
    SERVER_ERROR_TO_CLIENT[envelope.code] ??
    statusToFallbackCode(envelope.status);
  return new AuthRequestError({
    code,
    status: envelope.status,
    message: `Auth request failed (${envelope.code}) with HTTP ${envelope.status}`,
    requestId: envelope.requestId,
  });
}

/**
 * Normalize any thrown value into an `AuthRequestError`. A rejected `fetch`
 * (offline, DNS, aborted) becomes `network_error`; an already-typed error
 * passes through unchanged. Mirrors the network-error fallback in
 * `transcribe.ts` so callers can `catch` once and always read `.code`.
 */
export function toAuthRequestError(cause: unknown): AuthRequestError {
  if (cause instanceof AuthRequestError) return cause;
  return new AuthRequestError({
    code: "network_error",
    status: 0,
    message:
      cause instanceof Error
        ? `Auth request failed: ${cause.message}`
        : "Auth request failed",
  });
}

function statusToFallbackCode(status: number): AuthRequestErrorCode {
  if (status === 503) return "email_auth_disabled";
  if (status === 429) return "rate_limit";
  if (status === 400 || status === 422) return "invalid_body";
  return "server_error";
}
