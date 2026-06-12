import { resolveAuthSecret, resolveAuthUrl } from "@/lib/auth/env";
import { isGoogleOAuthConfigured } from "@/lib/auth/google-config";

/**
 * Fail fast at runtime when Google OAuth is enabled in production without
 * the secrets Auth.js needs. Skipped during `next build` module evaluation.
 */
export function assertProductionAuthConfig(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (!isGoogleOAuthConfigured()) return;

  if (!resolveAuthSecret()) {
    throw new Error(
      "AUTH_SECRET (or NEXTAUTH_SECRET) is required in production when Google OAuth is configured.",
    );
  }

  if (!resolveAuthUrl()) {
    console.warn(
      "[auth] AUTH_URL / MURMUR_APP_URL not set — relying on trustHost for OAuth redirects.",
    );
  }
}
