/**
 * Next.js instrumentation hook — runs once at server startup.
 *
 * Validates required environment variables early so misconfigured
 * deployments fail fast with an actionable error instead of crashing
 * later on the first request that touches the missing value.
 */

export async function register() {
  const isProd = process.env.NODE_ENV === "production";

  const missing: string[] = [];

  // Always required
  if (!process.env.DATABASE_URL) {
    missing.push("DATABASE_URL");
  }

  // Production-only requirements
  if (isProd) {
    if (!process.env.AUTH_SECRET) missing.push("AUTH_SECRET");
    if (!process.env.CRON_SECRET) missing.push("CRON_SECRET");
    if (!process.env.MURMUR_APP_URL) missing.push("MURMUR_APP_URL");
  }

  if (missing.length > 0) {
    const message = `Missing required environment variable(s): ${missing.join(", ")}`;
    if (isProd) {
      throw new Error(message);
    }
    console.warn(`[murmur:instrumentation] WARNING: ${message}`);
  }
}
