function isEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

/**
 * Server-authoritative gate for deployment-level local/demo fallbacks.
 *
 * Production access must come from an explicit server-side environment flag.
 * Request metadata is deliberately absent from this boundary: Host, URL, and
 * framework-derived nextUrl values are all controlled by or derived from the
 * incoming request and must never grant production privileges.
 */
export function shouldAllowDeploymentLocalPreview(): boolean {
  if (process.env.NODE_ENV === "development") return true;

  if (process.env.NODE_ENV === "production") {
    return isEnabled(process.env.MURMUR_ALLOW_PRODUCTION_LOCAL_PREVIEW);
  }

  if (process.env.NODE_ENV === "test") return false;

  return isEnabled(process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK);
}
