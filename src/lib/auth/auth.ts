import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { db } from "@/lib/db/client";
import { users, externalIdentities } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";

/**
 * Google OAuth is optional: without credentials the provider list is empty,
 * /api/auth/session answers "no session", and the app stays on the Local
 * Creator path. Registering Google with undefined credentials (the old `!`
 * casts) made authjs 500 on every request, which SessionProvider then
 * surfaced as a ClientFetchError on every page.
 */
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

export const { handlers, auth, signIn, signOut } = NextAuth({
  // authjs hard-requires a secret even for anonymous session reads.
  // Production must provide AUTH_SECRET (fail loudly if not); local dev
  // falls back to a fixed value so keyless setups boot cleanly.
  secret:
    process.env.AUTH_SECRET ??
    (process.env.NODE_ENV === "production"
      ? undefined
      : "murmur-dev-insecure-secret"),
  providers:
    googleClientId && googleClientSecret
      ? [
          Google({
            clientId: googleClientId,
            clientSecret: googleClientSecret,
          }),
        ]
      : [],
  pages: {
    signIn: "/",
  },
  callbacks: {
    async signIn({ user, account }) {
      if (!account || !user.email) return false;

      try {
        // Check if this Google account is already linked
        const [existingIdentity] = await db
          .select()
          .from(externalIdentities)
          .where(eq(externalIdentities.externalId, account.providerAccountId))
          .limit(1);

        if (!existingIdentity) {
          // New user - create account
          const newUserId = ulid();
          await db.insert(users).values({
            id: newUserId,
            email: user.email,
            name: user.name || user.email.split("@")[0],
            avatarUrl: user.image,
            regionId: "intl",
            notesBalance: 5,
            planTier: "free",
          });

          // Link Google identity
          await db.insert(externalIdentities).values({
            id: `eid_${ulid()}`,
            userId: newUserId,
            provider: "google",
            externalId: account.providerAccountId,
            metadata: {
              email: user.email,
              name: user.name,
            },
          });
        }

        // Session lookup happens in the session callback
        return true;
      } catch (error) {
        console.error("Sign in error:", error);
        return false;
      }
    },

    async session({ session, token }) {
      if (session.user && token.sub) {
        // Find user by Google ID
        const [identity] = await db
          .select()
          .from(externalIdentities)
          .where(eq(externalIdentities.externalId, token.sub))
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
