import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

type OkAuth = Extract<ResolvedRequestAuth, { ok: true }>;

/** Signed-in Murmur account (Google or session token) — not the shared guest id. */
export function isAuthenticatedSession(auth: OkAuth): boolean {
  return (
    auth.source === "session"
    && auth.user.id !== "guest"
    && auth.user.accountKind !== "local_creator"
  );
}

/**
 * Skip server ledger spends for preview identities.
 *
 * Registered users spend server-side notes from the ledger. Anonymous fallback
 * and Local Creator takes are quota-gated by the preview path until the
 * server-side Local Creator billing cutover is complete.
 */
export function shouldSkipNotesBilling(auth: OkAuth): boolean {
  return (
    (auth.source === "guest" && auth.user.id === "guest")
    || auth.user.accountKind === "local_creator"
  );
}
