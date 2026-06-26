import { shouldBypassBillingInDevelopment } from "@/lib/billing/dev-balance";

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
