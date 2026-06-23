export type DevBalanceFallback = {
  notes: number;
  planTier: "free";
};

const DEFAULT_DEV_NOTES = 9_999;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Billing fallback keeps local demos usable when the ledger DB is unreachable.
 * Enabled in development, on loopback hosts, or by explicit opt-in outside
 * production. Public production hosts must never expose the 9999-note demo
 * snapshot when the real ledger is unavailable.
 */
export function shouldUseDevBalanceFallback(options: {
  host?: string | null;
} = {}): boolean {
  const host = options.host?.trim().toLowerCase();
  if (host && LOOPBACK_HOSTS.has(host)) {
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
