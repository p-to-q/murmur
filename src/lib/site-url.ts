const DEFAULT_SITE_URL = "https://murmur.ptoq.io";

export function getSiteUrl(): string {
  const configured = process.env.MURMUR_APP_URL?.trim();
  if (configured) return stripTrailingSlash(configured);

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return `https://${stripTrailingSlash(vercelUrl.replace(/^https?:\/\//, ""))}`;
  }

  return DEFAULT_SITE_URL;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
