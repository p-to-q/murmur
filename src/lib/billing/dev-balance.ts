export type DevBalanceFallback = {
  notes: number;
  planTier: "free";
};

const DEFAULT_DEV_NOTES = 9_999;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Billing fallback keeps local demos usable when the ledger DB is unreachable.
 * Enabled in development, on loopback hosts (local builds only), or by explicit
 * opt-in outside production. On a managed cloud deployment (Vercel) the loopback
 * host signal is ignored, so a spoofed `Host: localhost` can never unlock the
 * 9999-note demo snapshot or free generation in production/preview.
 */
export function shouldUseDevBalanceFallback(options: {
  host?: string | null;
} = {}): boolean {
  // A request-supplied host is only trustworthy off managed cloud: local
  // production builds (`next build && next start`) set no VERCEL flag, so
  // loopback still works there; Vercel deployments must never honor it.
  const onManagedCloud = process.env.VERCEL === "1";
  const host = options.host?.trim().toLowerCase();
  if (!onManagedCloud && host && LOOPBACK_HOSTS.has(host)) {
    return true;
  }

  if (process.env.NODE_ENV === "development") {
    return true;
  }

  if (process.env.NODE_ENV === "production") {
    return false;
  }

  const flag = process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK?.trim().toLowerCase();
  return flag === "1" || flag === "true";
}

export function shouldBypassBillingInDevelopment(options: {
  host?: string | null;
} = {}): boolean {
  return shouldUseDevBalanceFallback(options);
}

export function getDevBalanceFallback(): DevBalanceFallback {
  const configured = Number(process.env.MURMUR_DEV_NOTES_BALANCE);
  const notes =
    Number.isFinite(configured) && configured > 0
      ? Math.floor(configured)
      : DEFAULT_DEV_NOTES;

  return {
    notes,
    planTier: "free",
  };
}
