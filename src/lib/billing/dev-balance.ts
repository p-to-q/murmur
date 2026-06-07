export type DevBalanceFallback = {
  notes: number;
  planTier: "free";
};

const DEFAULT_DEV_NOTES = 9_999;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * TODO: 临时跳过计费检查 - 生产环境也允许
 *
 * 移除这个临时措施前需要配置：
 * 1. Vercel: DATABASE_URL/POSTGRES_URL
 * 2. Vercel: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, AUTH_SECRET
 * 3. Google Cloud Console: 添加生产回调 URL
 * 4. 运行数据库迁移
 *
 * 配置完成后，删除 process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK 的检查
 */
export function shouldUseDevBalanceFallback(options: {
  host?: string | null;
} = {}): boolean {
  // TODO: 临时允许生产环境跳过计费
  // 配置完数据库后移除这个检查
  if (process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK === "1") {
    return true;
  }

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
