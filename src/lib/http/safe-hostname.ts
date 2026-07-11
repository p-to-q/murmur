/**
 * Extract the hostname from a URL string without throwing.
 *
 * Route handlers prefer `request.nextUrl.hostname`, but fall back to parsing
 * `request.url` (e.g. in unit tests or non-Next contexts). A malformed URL must
 * never crash the caller — it just means "host unknown", so we return null and
 * let the caller decide (typically: don't grant a localhost/dev bypass).
 */
export function safeHostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
