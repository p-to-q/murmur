const DEFAULT_SITE_URL = "https://murmur.ptoq.io";

export function getSiteUrl(): string {
  return getConfiguredSiteUrl() ?? DEFAULT_SITE_URL;
}

export function getSiteUrlForRequest(
  request: Request | { url?: string; nextUrl?: { origin?: string } },
): string {
  return getConfiguredSiteUrl() ?? getRequestOrigin(request) ?? DEFAULT_SITE_URL;
}

function getConfiguredSiteUrl(): string | null {
  const configured = process.env.MURMUR_APP_URL?.trim();
  if (configured) return stripTrailingSlash(configured);

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return `https://${stripTrailingSlash(vercelUrl.replace(/^https?:\/\//, ""))}`;
  }

  return null;
}

function getRequestOrigin(
  request: Request | { url?: string; nextUrl?: { origin?: string } },
): string | null {
  const nextOrigin = "nextUrl" in request ? request.nextUrl?.origin : null;
  if (isHttpOrigin(nextOrigin)) return stripTrailingSlash(nextOrigin);

  if (!request.url) return null;
  try {
    const origin = new URL(request.url).origin;
    return isHttpOrigin(origin) ? stripTrailingSlash(origin) : null;
  } catch {
    return null;
  }
}

function isHttpOrigin(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
