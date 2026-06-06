export type DevBalanceFallback = {
  notes: number;
  planTier: "free";
};

const DEFAULT_DEV_NOTES = 9_999;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function shouldUseDevBalanceFallback(options: {
  host?: string | null;
} = {}): boolean {
  if (process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK === "0") {
    return false;
  }

  if (process.env.NODE_ENV === "development") {
    return true;
  }

  const host = options.host?.trim().toLowerCase();
  return !!host && LOOPBACK_HOSTS.has(host);
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
