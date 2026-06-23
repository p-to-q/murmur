import type { NextRequest } from "next/server";

export function shouldExposeQaSurface(request: NextRequest): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return isLoopbackRequest(request);
}

function isLoopbackRequest(request: NextRequest): boolean {
  const hostname = getRequestHostname(request)?.toLowerCase().replace(/^\[|\]$/g, "");
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function getRequestHostname(request: NextRequest): string | null {
  const nextUrl = (request as { nextUrl?: { hostname?: string } }).nextUrl;
  if (nextUrl?.hostname) return nextUrl.hostname;

  try {
    return new URL(request.url).hostname;
  } catch {
    return null;
  }
}
