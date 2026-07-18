/** Resolve Auth.js secret with legacy NEXTAUTH_SECRET fallback. */
export function resolveAuthSecret(): string | undefined {
  return (
    process.env.AUTH_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    undefined
  );
}

/** Canonical app origin for OAuth redirects and share URLs. */
export function resolveAuthUrl(): string | undefined {
  return firstValidUrl(
    process.env.AUTH_URL,
    process.env.NEXTAUTH_URL,
    process.env.MURMUR_APP_URL,
    process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, "")}`
      : undefined,
  );
}

/**
 * Auth.js reads AUTH_URL / NEXTAUTH_URL during initialization. Normalize those
 * variables before `NextAuth(...)` so a malformed production env does not break
 * static route collection; `trustHost` can still derive the request host.
 */
export function prepareAuthUrlEnv(): void {
  const normalized = resolveAuthUrl();
  if (normalized) {
    process.env.AUTH_URL = normalized;
    process.env.NEXTAUTH_URL = normalized;
    return;
  }

  delete process.env.AUTH_URL;
  delete process.env.NEXTAUTH_URL;
}

function firstValidUrl(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = normalizeAuthUrl(value);
    if (normalized) return normalized;
  }
  return undefined;
}

export function normalizeAuthUrl(value: string | undefined): string | undefined {
  const trimmed = stripWrappingQuotes(value?.trim());
  if (!trimmed) return undefined;

  if (/^[a-z][a-z\d+\-.]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    return undefined;
  }

  const withProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (!url.hostname) return undefined;
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function stripWrappingQuotes(value: string | undefined): string | undefined {
  if (!value || value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
    return value.slice(1, -1).trim();
  }
  return value;
}
