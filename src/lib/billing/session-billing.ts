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

/** Skip server ledger spends only for the shared anonymous preview identity. */
export function shouldSkipNotesBilling(auth: OkAuth): boolean {
  return auth.source === "guest" && auth.user.id === "guest";
}
