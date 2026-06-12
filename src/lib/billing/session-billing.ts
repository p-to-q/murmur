import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

type OkAuth = Extract<ResolvedRequestAuth, { ok: true }>;

/** Signed-in Murmur account (Google or session token) — not the shared guest id. */
export function isAuthenticatedSession(auth: OkAuth): boolean {
  return auth.source === "session" && auth.user.id !== "guest";
}

/**
 * Skip ledger spends for:
 * - authenticated users (unlimited notes after sign-in)
 * - anonymous guest bucket (daily quota enforced client-side per device)
 */
export function shouldSkipNotesBilling(auth: OkAuth): boolean {
  if (isAuthenticatedSession(auth)) return true;
  return auth.source === "guest" && auth.user.id === "guest";
}
