import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import { CallbackRouteError } from "@auth/core/errors";
import { headers } from "next/headers";
import { db } from "@/lib/db/client";
import { users, externalIdentities } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import {
  googleOAuthProviderOptions,
  isGoogleOAuthConfigured,
} from "@/lib/auth/google-config";
import {
  gitHubOAuthProviderOptions,
  isGitHubOAuthConfigured,
} from "@/lib/auth/github-config";
import { resolveAuthSecret } from "@/lib/auth/env";
import { assertProductionAuthConfig } from "@/lib/auth/assert-config";
import { upsertOAuthUser } from "@/lib/db/queries/users";
import { getSessionByToken } from "@/lib/db/queries/sessions";
import { getSessionToken } from "@/lib/platform/server-auth";
import { log } from "@/lib/observability/log";
import { readShareReferrerFromCookieHeader } from "@/lib/api/share-referral-server";
import { settleRegistrationShareReferral } from "@/lib/auth/share-referral-settlement";

const googleConfigured = isGoogleOAuthConfigured();
const githubConfigured = isGitHubOAuthConfigured();

assertProductionAuthConfig();

const providers = [
  ...(googleConfigured ? [Google(googleOAuthProviderOptions())] : []),
  ...(githubConfigured ? [GitHub(gitHubOAuthProviderOptions())] : []),
];

const SUPPORTED_PROVIDERS = new Set(["google", "github"]);

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret:
    resolveAuthSecret() ??
    (process.env.NODE_ENV === "production"
      ? undefined
      : "murmur-dev-insecure-secret"),
  providers,
  pages: {
    signIn: "/",
    error: "/auth/error",
  },
  callbacks: {
    async signIn({ user, account }) {
      if (!account || !SUPPORTED_PROVIDERS.has(account.provider) || !user.email)
        return false;

      const externalId = account.providerAccountId;
      if (!externalId) return false;

      try {
        const cookieHeader = await resolveCurrentCookieHeader();
        const localCreatorUserId = await resolveCurrentLocalCreatorUserId(cookieHeader);
        const { userId, created, registrationKind } = await upsertOAuthUser({
          provider: account.provider,
          externalId,
          email: user.email,
          name: user.name ?? null,
          image: user.image ?? null,
          localCreatorUserId,
        });
        if (created) {
          log(
            "auth.user_provisioned",
            { provider: account.provider },
            { route: `/api/auth/callback/${account.provider}`, shell: "web" },
          );
        }
        await settleRegistrationShareReferral({
          referrerId: readShareReferrerFromCookieHeader(cookieHeader),
          inviteeId: userId,
          registrationKind,
          source: "oauth",
          route: `/api/auth/callback/${account.provider}`,
          metadata: {
            provider: account.provider,
          },
        });
        return true;
      } catch (error) {
        log(
          "auth.signin_failed",
          {
            provider: account.provider,
            stage: "upsert",
            err: error instanceof Error ? error.name : "unknown",
          },
          {
            level: "error",
            route: `/api/auth/callback/${account.provider}`,
            shell: "web",
          },
        );
        throw new CallbackRouteError(
          `${account.provider} sign-in could not be completed`,
          {
            cause:
              error instanceof Error
                ? error
                : new Error("signIn upsert failed"),
          },
        );
      }
    },

    async jwt({ token, account }) {
      if (account?.providerAccountId) {
        token.oauthProvider = account.provider;
        token.oauthSub = account.providerAccountId;
      }

      // Back-compat: read legacy googleSub if oauthSub not set yet
      const sub =
        typeof token.oauthSub === "string"
          ? token.oauthSub
          : typeof token.googleSub === "string"
            ? token.googleSub
            : typeof token.sub === "string"
              ? token.sub
              : null;

      if (sub && !token.murmurUserId) {
        try {
          const provider =
            typeof token.oauthProvider === "string"
              ? token.oauthProvider
              : "google";
          const [identity] = await db
            .select({ userId: externalIdentities.userId })
            .from(externalIdentities)
            .where(
              and(
                eq(externalIdentities.provider, provider),
                eq(externalIdentities.externalId, sub),
              ),
            )
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

      const authProvider =
        typeof token.oauthProvider === "string"
          ? token.oauthProvider
          : "google";

      if (murmurUserId) {
        const [user] = await db
          .select()
          .from(users)
          .where(and(eq(users.id, murmurUserId), isNull(users.deletedAt)))
          .limit(1);

        if (user) {
          session.user.id = user.id;
          session.user.email = user.email || session.user.email;
          session.user.name = user.name || session.user.name;
          session.user.image = user.avatarUrl || session.user.image;
          session.user.accountKind =
            user.accountKind === "local_creator"
              ? "local_creator"
              : "registered";
          session.user.authProvider = authProvider;
          return session;
        }
      }

      delete (session.user as { id?: string }).id;
      delete (session.user as { accountKind?: string }).accountKind;
      delete (session.user as { authProvider?: string }).authProvider;

      // Fallback: resolve by externalId from token
      const sub =
        typeof token.oauthSub === "string"
          ? token.oauthSub
          : typeof token.googleSub === "string"
            ? token.googleSub
            : typeof token.sub === "string"
              ? token.sub
              : null;

      if (sub) {
        const provider =
          typeof token.oauthProvider === "string"
            ? token.oauthProvider
            : "google";

        const [identity] = await db
          .select()
          .from(externalIdentities)
          .where(
            and(
              eq(externalIdentities.provider, provider),
              eq(externalIdentities.externalId, sub),
            ),
          )
          .limit(1);

        if (identity) {
          const [user] = await db
            .select()
            .from(users)
            .where(and(eq(users.id, identity.userId), isNull(users.deletedAt)))
            .limit(1);

          if (user) {
            session.user.id = user.id;
            session.user.email = user.email || session.user.email;
            session.user.name = user.name || session.user.name;
            session.user.image = user.avatarUrl || session.user.image;
            session.user.accountKind =
              user.accountKind === "local_creator"
                ? "local_creator"
                : "registered";
            session.user.authProvider = provider;
          }
        }
      }

      return session;
    },
  },
  trustHost: true,
});

async function resolveCurrentCookieHeader(): Promise<string | null> {
  try {
    const headerStore = await headers();
    return headerStore.get("cookie");
  } catch {
    return null;
  }
}

async function resolveCurrentLocalCreatorUserId(cookieHeader?: string | null): Promise<string | null> {
  try {
    const cookie = cookieHeader ?? await resolveCurrentCookieHeader();
    if (!cookie) return null;
    const token = getSessionToken(
      new Request("http://murmur.local", { headers: { cookie } }),
    );
    if (!token) return null;
    const session = await getSessionByToken(token);
    return session?.user.accountKind === "local_creator" ? session.user.id : null;
  } catch {
    return null;
  }
}
