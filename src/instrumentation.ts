/**
 * Next.js instrumentation hook — runs once per server runtime at startup.
 *
 * Surfaces deployment misconfiguration as one loud, actionable log line
 * instead of a scattered trail of per-request failures.
 *
 * This check warns and never throws: every variable below either fails
 * closed at request time (DATABASE_URL → 503s, AUTH_SECRET → sign-in
 * errors, CRON_SECRET → cron routes reject everything) or has a safe
 * default (MURMUR_APP_URL → request origin, MURMUR_AUTH_MODE → strict
 * "production" auth mode). Vercel preview deployments run with
 * NODE_ENV=production but without the full production env, so throwing
 * here would turn a degraded deployment into a dead one.
 */

export async function register() {
  // Only validate in the Node.js runtime — the edge runtime doesn't carry
  // the server env, and warning there would just duplicate the log line.
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const warnings = collectEnvWarnings(process.env);
  if (warnings.length > 0) {
    console.warn(
      "[murmur:instrumentation] Environment configuration warning(s):\n"
        + warnings.map((warning) => `  - ${warning}`).join("\n"),
    );
  }
}

export function collectEnvWarnings(
  env: Record<string, string | undefined>,
): string[] {
  const isProd = env.NODE_ENV === "production";
  const warnings: string[] = [];

  if (!env.DATABASE_URL) {
    warnings.push(
      "DATABASE_URL is not set — database-backed routes will fail with 503s",
    );
  }

  if (!isProd) return warnings;

  if (!env.AUTH_SECRET) {
    warnings.push("AUTH_SECRET is not set — Google sign-in will fail");
  }
  if (!env.CRON_SECRET) {
    warnings.push(
      "CRON_SECRET is not set — scheduled cron routes will reject every invocation",
    );
  }
  if (!env.MURMUR_APP_URL) {
    warnings.push(
      "MURMUR_APP_URL is not set — share links will fall back to the request origin",
    );
  }

  // Mirrors resolveAuthRuntimeMode() in src/lib/platform/server-auth.ts:
  // unset resolves to the strict "production" mode, so this is safe — but
  // it should be an explicit choice, not an accident.
  const authMode = env.MURMUR_AUTH_MODE?.trim().toLowerCase();
  if (!authMode) {
    warnings.push(
      'MURMUR_AUTH_MODE is not set — defaulting to the strict "production" auth mode',
    );
  } else if (authMode !== "production" && authMode !== "prod") {
    warnings.push(
      `MURMUR_AUTH_MODE="${authMode}" enables non-production auth fallbacks while NODE_ENV=production — expected on previews, never on the live deployment`,
    );
  }

  return warnings;
}
