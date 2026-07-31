import type { AppUser } from "./types";
import { auth as nextAuthSession } from "@/lib/auth/auth";
import { getSessionByToken, type ResolvedSession } from "@/lib/db/queries/sessions";
import {
  getSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth/session-token";

export { getSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS };

type AuthRuntimeMode = "production" | "demo" | "local";

const DEFAULT_USER: AppUser = {
  id: "guest",
  email: null,
  name: "Local Creator",
  avatarUrl: null,
  accountKind: "local_creator",
};

function readHeader(request: Request, key: string): string | null {
  return request.headers.get(key)?.trim() || null;
}

export function murmurSessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function clearMurmurSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  };
}

export function getRequestUser(request: Request): AppUser {
  // v1 local-user headers are a local/demo convenience only. Production
  // identity must resolve through resolveRequestAuth() and a DB-backed session.
  if (!isHeaderAuthAllowed()) {
    return DEFAULT_USER;
  }

  return {
    id: readHeader(request, "x-murmur-user-id") ?? DEFAULT_USER.id,
    email: readHeader(request, "x-murmur-user-email"),
    name: readHeader(request, "x-murmur-user-name") ?? DEFAULT_USER.name,
    avatarUrl: readHeader(request, "x-murmur-user-avatar"),
  };
}

export type RequestAuthSource = "session" | "local_header" | "guest";

export type ResolvedRequestAuth =
  | {
      ok: true;
      user: AppUser;
      source: RequestAuthSource;
      sessionId: string | null;
    }
  | {
      ok: false;
      response: Response;
    };

export interface ResolveRequestAuthOptions {
  allowGuestPreview?: boolean;
}

type NextAuthSessionLike = { user?: unknown } | null;

/**
 * Dependency-injection seam for unit tests. Production callers omit `deps` and
 * get the real DB session + NextAuth lookups via {@link DEFAULT_DEPS}.
 */
export interface ResolveRequestAuthDeps {
  getSessionByToken: (token: string) => Promise<ResolvedSession | null>;
  getNextAuthSession: () => Promise<NextAuthSessionLike>;
}

const DEFAULT_DEPS: ResolveRequestAuthDeps = {
  getSessionByToken: (token) => getSessionByToken(token),
  getNextAuthSession: () => nextAuthSession(),
};

export async function resolveRequestAuth(
  request: Request,
  options: ResolveRequestAuthOptions = {},
  deps: ResolveRequestAuthDeps = DEFAULT_DEPS,
): Promise<ResolvedRequestAuth> {
  const mode = resolveAuthRuntimeMode();
  const token = getSessionToken(request);
  let invalidSessionAuth: Extract<ResolvedRequestAuth, { ok: false }> | null = null;
  // Local Creator can be created before save/generate/auth handoff, so a
  // browser can hold both this Murmur cookie and a NextAuth cookie. It must
  // NOT shadow a real OAuth sign-in: a local_creator session is held here and
  // only used when no NextAuth session resolves. A registered session —
  // including an lc_ row promoted to registered in place during sign-in —
  // is a real identity and still short-circuits immediately.
  let localCreatorAuth: Extract<ResolvedRequestAuth, { ok: true }> | null = null;
  if (token) {
    let session: ResolvedSession | null = null;
    let sessionLookupFailed = false;
    try {
      session = await deps.getSessionByToken(token);
    } catch (error) {
      // Murmur session infrastructure is unavailable. Do NOT return 503 yet:
      // a valid Auth.js (Google) session must still be able to authenticate
      // the request. Hold the 503 and fall through to the NextAuth lookup for
      // BOTH route modes — mirroring the guest-preview fall-through so normal
      // and guest-preview routes share one precedence order. If no real
      // identity resolves, the honest 503 is returned below (or, on
      // guest-preview routes, guest access).
      invalidSessionAuth = authError(
        "session_unavailable",
        error instanceof Error ? error.message : "Session lookup failed",
        503,
      );
      sessionLookupFailed = true;
    }

    if (sessionLookupFailed) {
      // Murmur session DB is offline for this request. Skip the cookie-session
      // branch entirely and let a registered Auth.js session resolve below;
      // if none does, the held 503 (or guest preview) is returned.
    } else if (!session) {
      invalidSessionAuth = authError(
        "unauthorized",
        "Invalid or expired session",
        401,
      );
    } else if (session.user.accountKind === "local_creator") {
      localCreatorAuth = {
        ok: true,
        user: session.user,
        source: "session",
        sessionId: session.sessionId,
      };
    } else {
      return {
        ok: true,
        user: session.user,
        source: "session",
        sessionId: session.sessionId,
      };
    }
  }

  // NextAuth (Google) session. The web client signs in through authjs, whose
  // JWT cookie the API routes previously never consulted — production
  // identity then collapsed to the shared guest user, putting every
  // visitor's songs and balance in one bucket. A Google session also wins over
  // a held Local Creator cookie so returning users are not stuck as lc_…
  try {
    const nextAuth = await deps.getNextAuthSession();
    const nextAuthUser = nextAuth?.user as
      | { id?: string; email?: string | null; name?: string | null; image?: string | null }
      | undefined;
    if (nextAuthUser?.id && nextAuthUser.id !== DEFAULT_USER.id) {
      return {
        ok: true,
        user: {
          id: nextAuthUser.id,
          email: nextAuthUser.email ?? null,
          name: nextAuthUser.name ?? DEFAULT_USER.name,
          avatarUrl: nextAuthUser.image ?? null,
          accountKind: "registered",
        },
        source: "session",
        sessionId: null,
      };
    }
  } catch {
    // authjs not configured / no request scope — fall through to auth-mode
    // fallback handling below. In production that means a clean 401.
  }

  // No Google session won — fall back to the held Local Creator session, which
  // is a valid identity even though Google takes priority when both exist.
  if (localCreatorAuth) {
    return localCreatorAuth;
  }

  if (!options.allowGuestPreview && !areAuthFallbacksAllowed(mode)) {
    return invalidSessionAuth ?? authError("unauthorized", "Authentication required", 401);
  }

  const user = options.allowGuestPreview ? DEFAULT_USER : getRequestUser(request);
  return {
    ok: true,
    user,
    source: user.id === DEFAULT_USER.id ? "guest" : "local_header",
    sessionId: null,
  };
}

let warnedUnsetAuthMode = false;

export function resolveAuthRuntimeMode(): AuthRuntimeMode {
  const configured = process.env.MURMUR_AUTH_MODE?.trim().toLowerCase();
  if (configured === "production" || configured === "prod") return "production";
  if (configured === "demo") return "demo";
  if (configured === "local" || configured === "development" || configured === "dev") {
    return "local";
  }

  // Unset or unrecognized values fall back to "production" — the strictest
  // mode, so a missing variable can never widen access. Auth bypass requires
  // an explicit "local"/"dev" value, which the branches above already gate.
  // Warn (once) instead of throwing: Vercel preview deploys run with
  // NODE_ENV=production but without the full prod env, and a throw here would
  // turn a missing variable into a total outage.
  if (process.env.NODE_ENV === "production" && !warnedUnsetAuthMode) {
    warnedUnsetAuthMode = true;
    console.warn(
      configured
        ? `[server-auth] Unrecognized MURMUR_AUTH_MODE "${configured}"; defaulting to strict "production" auth mode.`
        : '[server-auth] MURMUR_AUTH_MODE is not set; defaulting to strict "production" auth mode. Set it explicitly to silence this warning.',
    );
  }

  return "production";
}

export function areAuthFallbacksAllowed(
  mode = resolveAuthRuntimeMode(),
): boolean {
  return mode !== "production";
}

export function isHeaderAuthAllowed(): boolean {
  if (!areAuthFallbacksAllowed()) return false;

  const configured = process.env.MURMUR_ALLOW_HEADER_AUTH?.trim().toLowerCase();
  if (configured === "1" || configured === "true") return true;
  if (configured === "0" || configured === "false") return false;
  return resolveAuthRuntimeMode() === "local";
}

function authError(
  error: string,
  message: string,
  status: number,
): Extract<ResolvedRequestAuth, { ok: false }> {
  return {
    ok: false,
    response: new Response(JSON.stringify({ error, message }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  };
}

export type { AppUser as User };
