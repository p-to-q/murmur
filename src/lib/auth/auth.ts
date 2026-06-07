import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { db } from "@/lib/db/client";
import { users, sessions, externalIdentities } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createHash } from "crypto";
import { ulid } from "ulid";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
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

        let userId: string;

        if (existingIdentity) {
          // Existing user - use their ID
          userId = existingIdentity.userId;
        } else {
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

          userId = newUserId;
        }

        // Create session (will be handled by session callback)
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
