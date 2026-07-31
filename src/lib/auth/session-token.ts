export const SESSION_COOKIE_NAME = "__murmur_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function getSessionToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim() || null;
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim() || null;
  }

  const cookie = request.headers.get("cookie")?.trim();
  if (!cookie) return null;
  for (const pair of cookie.split(";")) {
    const [rawKey, ...rawValue] = pair.trim().split("=");
    if (rawKey === SESSION_COOKIE_NAME) {
      return decodeURIComponent(rawValue.join("=")).trim() || null;
    }
  }
  return null;
}
