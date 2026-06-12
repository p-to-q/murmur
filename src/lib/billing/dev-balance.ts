export type DevBalanceFallback = {
  notes: number;
  planTier: "free";
};

const DEFAULT_DEV_NOTES = 9_999;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Billing fallback keeps local demos usable when the ledger DB is unreachable.
 * Enabled when NODE_ENV is development, the host is loopback, or
 * MURMUR_ALLOW_DEV_BILLING_FALLBACK is explicitly set to 1/true.
 */
export function shouldUseDevBalanceFallback(options: {
  host?: string | null;
} = {}): boolean {
  if (process.env.NODE_ENV === "development") {
    return true;
  }

  const host = options.host?.trim().toLowerCase();
  if (host && LOOPBACK_HOSTS.has(host)) {
    return true;
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
