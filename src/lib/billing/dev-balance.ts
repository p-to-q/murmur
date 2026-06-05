export type DevBalanceFallback = {
  notes: number;
  planTier: "free";
};

const DEFAULT_DEV_NOTES = 9_999;

export function shouldUseDevBalanceFallback(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK !== "0"
  );
}

export function shouldBypassBillingInDevelopment(): boolean {
  return shouldUseDevBalanceFallback();
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
