import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

type OkAuth = Extract<ResolvedRequestAuth, { ok: true }>;

/** Signed-in Murmur account (Google or session token) — not the shared guest id. */
export function isAuthenticatedSession(auth: OkAuth): boolean {
  return auth.source === "session" && auth.user.id !== "guest";
}

/**
 * Preview-only billing bypass.
 *
 * This is not the launch pricing contract: signed-in users are temporarily
 * treated as unlimited so the product can be tested without purchase friction.
 * Before paid launch, authenticated free users should spend ledger notes again
 * and only an explicit premium/internal entitlement should bypass billing.
 *
 * Skip ledger spends for:
 * - authenticated users during the preview window
 * - anonymous guest bucket (daily quota enforced client-side per device)
 */
export function shouldSkipNotesBilling(auth: OkAuth): boolean {
  if (isAuthenticatedSession(auth)) return true;
  return auth.source === "guest" && auth.user.id === "guest";
}
