const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const COOKIE_AUTH_NAMES = [
  "__murmur_session",
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
] as const;

export type SameOriginGuardResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: "missing_origin" | "cross_origin";
      requestOrigin: string | null;
      targetOrigin: string;
    };

export function validateCookieAuthenticatedSameOrigin(
  request: Pick<Request, "headers" | "method" | "url">,
): SameOriginGuardResult {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return { allowed: true };
  if (!hasCookieAuthenticatedSession(request.headers)) return { allowed: true };

  const targetOrigin = new URL(request.url).origin;
  const requestOrigin = originFromHeaders(request.headers);
  if (!requestOrigin) {
    return { allowed: false, reason: "missing_origin", requestOrigin, targetOrigin };
  }
  if (requestOrigin !== targetOrigin) {
    return { allowed: false, reason: "cross_origin", requestOrigin, targetOrigin };
  }
  return { allowed: true };
}

export function hasCookieAuthenticatedSession(headers: Headers): boolean {
  const cookieHeader = headers.get("cookie");
  if (!cookieHeader) return false;

  return cookieHeader.split(";").some((pair) => {
    const [rawName] = pair.trim().split("=");
    const name = rawName?.trim();
    if (!name) return false;
    return COOKIE_AUTH_NAMES.some(
      (cookieName) => name === cookieName || name.startsWith(`${cookieName}.`),
    );
  });
}

function originFromHeaders(headers: Headers): string | null {
  return parseOrigin(headers.get("origin")) ?? parseOrigin(headers.get("referer"));
}

function parseOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
