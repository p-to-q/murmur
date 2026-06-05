import type { AppUser, AuthResult } from "./types";
import { getSessionByToken } from "@/lib/db/queries/sessions";

export const SESSION_COOKIE_NAME = "__murmur_session";

const DEFAULT_USER: AppUser = {
  id: "guest",
  email: null,
  name: "Local Creator",
  avatarUrl: null,
};

function readHeader(request: Request, key: string): string | null {
  return request.headers.get(key)?.trim() || null;
}

export function getSessionToken(request: Request): string | null {
  const authorization = readHeader(request, "authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim() || null;
  }

  const cookie = readHeader(request, "cookie");
  if (!cookie) return null;

  for (const pair of cookie.split(";")) {
    const [rawKey, ...rawValue] = pair.trim().split("=");
    if (rawKey === SESSION_COOKIE_NAME) {
      return decodeURIComponent(rawValue.join("=")).trim() || null;
    }
  }
  return null;
}

export function getRequestUser(request: Request): AppUser {
  // Phase 3 substrate: real session lookup plugs in here. Until then, never let
  // v1 local-user headers decide identity in production unless explicitly
  // enabled for a trusted local/demo environment.
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

export function resolveUserId(request: Request): string {
  return getRequestUser(request).id;
}

export function requireAuth(request: Request): AuthResult {
  return { ok: true, user: getRequestUser(request) };
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

export async function resolveRequestAuth(
  request: Request,
): Promise<ResolvedRequestAuth> {
  const token = getSessionToken(request);
  if (token) {
    let session;
    try {
      session = await getSessionByToken(token);
    } catch (error) {
      return authError(
        "session_unavailable",
        error instanceof Error ? error.message : "Session lookup failed",
        503,
      );
    }

    if (!session) {
      return authError("unauthorized", "Invalid or expired session", 401);
    }

    return {
      ok: true,
      user: session.user,
      source: "session",
      sessionId: session.sessionId,
    };
  }

  const user = getRequestUser(request);
  return {
    ok: true,
    user,
    source: user.id === DEFAULT_USER.id ? "guest" : "local_header",
    sessionId: null,
  };
}

export function isHeaderAuthAllowed(): boolean {
  const configured = process.env.MURMUR_ALLOW_HEADER_AUTH?.trim().toLowerCase();
  if (configured === "1" || configured === "true") return true;
  if (configured === "0" || configured === "false") return false;
  return process.env.NODE_ENV !== "production";
}

function authError(error: string, message: string, status: number): ResolvedRequestAuth {
  return {
    ok: false,
    response: new Response(JSON.stringify({ error, message }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  };
}

export type { AppUser as User, AuthResult };
