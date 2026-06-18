import { resolveAuthSecret, resolveAuthUrl } from "@/lib/auth/env";
import { isGoogleOAuthConfigured } from "@/lib/auth/google-config";
import { isGitHubOAuthConfigured } from "@/lib/auth/github-config";

export function assertProductionAuthConfig(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const anyOAuth = isGoogleOAuthConfigured() || isGitHubOAuthConfigured();
  if (!anyOAuth) return;

  if (!resolveAuthSecret()) {
    throw new Error(
      "AUTH_SECRET (or NEXTAUTH_SECRET) is required in production when an OAuth provider is configured.",
    );
  }

  if (!resolveAuthUrl()) {
    console.warn(
      "[auth] AUTH_URL / MURMUR_APP_URL not set — relying on trustHost for OAuth redirects.",
    );
  }
}
