import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { db } from "@/lib/db/client";
import { users, externalIdentities } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import {
  googleOAuthProviderOptions,
  isGoogleOAuthConfigured,
} from "@/lib/auth/google-config";

/**
 * Google OAuth is optional: without credentials the provider list is empty,
 * /api/auth/session answers "no session", and the app stays on the Local
 * Creator path. Registering Google with undefined credentials (the old `!`
 * casts) made authjs 500 on every request, which SessionProvider then
 * surfaced as a ClientFetchError on every page.
 */
const googleConfigured = isGoogleOAuthConfigured();

export const { handlers, auth, signIn, signOut } = NextAuth({
  // authjs hard-requires a secret even for anonymous session reads.
  // Production must provide AUTH_SECRET (fail loudly if not); local dev
  // falls back to a fixed value so keyless setups boot cleanly.
  secret:
    process.env.AUTH_SECRET ??
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
      if (!account || account.provider !== "google" || !user.email) return false;

      const googleId = account.providerAccountId;
      if (!googleId) return false;

      try {
        const [existingIdentity] = await db
          .select()
          .from(externalIdentities)
          .where(eq(externalIdentities.externalId, googleId))
          .limit(1);

        if (!existingIdentity) {
          const newUserId = ulid();
          await db.insert(users).values({
            id: newUserId,
            email: user.email,
            name: user.name || user.email.split("@")[0],
            avatarUrl: user.image,
            regionId: "intl",
            notesBalance: 0,
            planTier: "free",
          });

          await db.insert(externalIdentities).values({
            id: `eid_${ulid()}`,
            userId: newUserId,
            provider: "google",
            externalId: googleId,
            metadata: {
              email: user.email,
              name: user.name,
            },
          });
        } else {
          await db
            .update(users)
            .set({
              name: user.name || undefined,
              avatarUrl: user.image || undefined,
              updatedAt: new Date(),
            })
            .where(eq(users.id, existingIdentity.userId));
        }

        return true;
      } catch (error) {
        console.error("Sign in error:", error);
        return false;
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
        const [identity] = await db
          .select({ userId: externalIdentities.userId })
          .from(externalIdentities)
          .where(eq(externalIdentities.externalId, googleSub))
          .limit(1);
        if (identity) token.murmurUserId = identity.userId;
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
