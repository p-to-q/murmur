/**
 * Best-effort client IP for rate limiting.
 *
 * x-real-ip is set by the trusted edge (Vercel). In x-forwarded-for only the
 * right-most hop was appended by infrastructure we trust — clients can
 * prepend arbitrary values to mint fresh rate-limit buckets per request, so
 * never read the left end.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",");
    const last = hops[hops.length - 1]?.trim();
    if (last) return last;
  }
  return "unknown";
}
