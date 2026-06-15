import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { CallbackRouteError } from "@auth/core/errors";
import { db } from "@/lib/db/client";
import { users, externalIdentities } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  googleOAuthProviderOptions,
  isGoogleOAuthConfigured,
} from "@/lib/auth/google-config";
import { resolveAuthSecret } from "@/lib/auth/env";
import { assertProductionAuthConfig } from "@/lib/auth/assert-config";
import { upsertGoogleUser } from "@/lib/db/queries/users";
import { log } from "@/lib/observability/log";

/**
 * Google OAuth is optional: without credentials the provider list is empty,
 * /api/auth/session answers "no session", and the app stays on the Local
 * Creator path. Registering Google with undefined credentials (the old `!`
 * casts) made authjs 500 on every request, which SessionProvider then
 * surfaced as a ClientFetchError on every page.
 */
const googleConfigured = isGoogleOAuthConfigured();

assertProductionAuthConfig();

export const { handlers, auth, signIn, signOut } = NextAuth({
  // authjs hard-requires a secret even for anonymous session reads.
  // Production must provide AUTH_SECRET (fail loudly if not); local dev
  // falls back to a fixed value so keyless setups boot cleanly.
  secret:
    resolveAuthSecret() ??
    (process.env.NODE_ENV === "production"
      ? undefined
      : "murmur-dev-insecure-secret"),
  providers: googleConfigured
    ? [Google(googleOAuthProviderOptions())]
    : [],
  pages: {
    signIn: "/",
    error: "/auth/error",
  },
  callbacks: {
    async signIn({ user, account }) {
      // Benign validation rejections: returning false routes to
      // /auth/error?error=AccessDenied ("you cancelled"), which is the right
      // UX for these non-error cases (wrong provider / missing email).
      if (!account || account.provider !== "google" || !user.email) return false;

      const googleId = account.providerAccountId;
      if (!googleId) return false;

      try {
        const { created } = await upsertGoogleUser({
          googleId,
          email: user.email,
          name: user.name ?? null,
          image: user.image ?? null,
        });
        if (created) {
          log(
            "auth.user_provisioned",
            { provider: "google" },
            { route: "/api/auth/callback/google", shell: "web" },
          );
        }
        return true;
      } catch (error) {
        // Infra/DB failure. Do NOT return false — that maps to the misleading
        // AccessDenied ("you cancelled"). Log a non-PII summary, then throw an
        // AuthError whose type is not client-safe so Auth.js routes to
        // /auth/error?error=Configuration ("server couldn't finish sign-in").
        log(
          "auth.signin_failed",
          {
            provider: "google",
            stage: "upsert",
            err: error instanceof Error ? error.name : "unknown",
          },
          { level: "error", route: "/api/auth/callback/google", shell: "web" },
        );
        throw new CallbackRouteError("Google sign-in could not be completed", {
          cause: error instanceof Error ? error : new Error("signIn upsert failed"),
        });
      }
    },

    async jwt({ token, account }) {
      if (account?.provider === "google" && account.providerAccountId) {
        token.googleSub = account.providerAccountId;
      }

      const googleSub =
        typeof token.googleSub === "string"
          ? token.googleSub
          : typeof token.sub === "string"
            ? token.sub
            : null;

      if (googleSub && !token.murmurUserId) {
        try {
          const [identity] = await db
            .select({ userId: externalIdentities.userId })
            .from(externalIdentities)
            .where(eq(externalIdentities.externalId, googleSub))
            .limit(1);
          if (identity) token.murmurUserId = identity.userId;
        } catch (error) {
          console.error("JWT identity lookup error:", error);
        }
      }

      return token;
    },

    async session({ session, token }) {
      if (!session.user) return session;

      const murmurUserId =
        typeof token.murmurUserId === "string" ? token.murmurUserId : null;

      if (murmurUserId) {
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, murmurUserId))
          .limit(1);

        if (user) {
          session.user.id = user.id;
          session.user.email = user.email || session.user.email;
          session.user.name = user.name || session.user.name;
          session.user.image = user.avatarUrl || session.user.image;
          return session;
        }
      }

      const googleSub =
        typeof token.googleSub === "string"
          ? token.googleSub
          : typeof token.sub === "string"
            ? token.sub
            : null;

      if (googleSub) {
        const [identity] = await db
          .select()
          .from(externalIdentities)
          .where(eq(externalIdentities.externalId, googleSub))
          .limit(1);

        if (identity) {
          const [user] = await db
            .select()
            .from(users)
            .where(eq(users.id, identity.userId))
            .limit(1);

          if (user) {
            session.user.id = user.id;
            session.user.email = user.email || session.user.email;
            session.user.name = user.name || session.user.name;
            session.user.image = user.avatarUrl || session.user.image;
          }
        }
      }

      return session;
    },
  },
  trustHost: true,
});
