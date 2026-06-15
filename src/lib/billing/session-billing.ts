import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

type OkAuth = Extract<ResolvedRequestAuth, { ok: true }>;

/** Signed-in Murmur account (Google or session token) — not the shared guest id. */
export function isAuthenticatedSession(auth: OkAuth): boolean {
  return auth.source === "session" && auth.user.id !== "guest";
}

/**
 * Skip ledger spends only for the anonymous guest bucket.
 *
 * Signed-in users spend server-side notes from the ledger. Guest takes are
 * quota-gated client-side per device and resolve to the shared guest id.
 */
export function shouldSkipNotesBilling(auth: OkAuth): boolean {
  return auth.source === "guest" && auth.user.id === "guest";
}
