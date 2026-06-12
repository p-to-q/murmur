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
  return (
    process.env.AUTH_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    process.env.MURMUR_APP_URL?.trim() ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, "")}`
      : undefined)
  );
}
