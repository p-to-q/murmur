import { shouldAllowDeploymentLocalPreview } from "@/lib/deployment/local-preview";

export type DevBalanceFallback = {
  notes: number;
  planTier: "free";
};

const DEFAULT_DEV_NOTES = 9_999;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Billing fallback keeps explicitly enabled local demos usable when the ledger
 * DB is unreachable. Production authorization is delegated to the shared
 * deployment gate and never derived from request-supplied host or URL values.
 */
export function shouldUseDevBalanceFallback(options: {
  host?: string | null;
} = {}): boolean {
  // Preserve loopback-based fixtures in NODE_ENV=test without carrying that
  // request-derived signal into any production decision.
  const host = options.host?.trim().toLowerCase();
  if (process.env.NODE_ENV === "test" && host && LOOPBACK_HOSTS.has(host)) {
    return true;
  }

  return shouldAllowDeploymentLocalPreview();
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
