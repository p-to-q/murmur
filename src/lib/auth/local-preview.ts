import { shouldBypassBillingInDevelopment } from "@/lib/billing/dev-balance";

/**
 * Local preview routes may fall back to the process-local song store when the
 * developer database is down. Keep this opt-in and host-gated so production
 * owner routes never silently become guest routes.
 */
export function shouldAllowLocalPreviewFallback(request: Request): boolean {
  return shouldBypassBillingInDevelopment({
    host: getRequestHostname(request),
  });
}

export function getRequestHostname(request: Request): string | null {
  const nextUrl = (request as { nextUrl?: { hostname?: string } }).nextUrl;
  if (nextUrl?.hostname) return nextUrl.hostname;

  try {
    return new URL(request.url).hostname;
  } catch {
    return null;
  }
}
