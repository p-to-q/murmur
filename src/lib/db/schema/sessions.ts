/**
 * sessions — server-issued session records.
 *
 * Authoritative reference: docs/data-model.md §3.3 + docs/user-model.md §4.
 *
 * The opaque session token leaves the server exactly once. Only its
 * SHA-256 hash is stored. Authentication compares the hash on every
 * request.
 *
 * Registered in schema/index.ts as the Phase 3 session substrate.
 */

import { pgTable, text, varchar, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { users } from "./users";

export const sessions = pgTable(
  "sessions",
  {
    id:         text("id").primaryKey(),                      // ulid `ses_…`
    userId:     varchar("user_id", { length: 128 }).notNull().references(() => users.id, { onDelete: "cascade" }),
    shell:      varchar("shell", { length: 16 }).notNull(),   // web | ios | android | wechat_mp
    tokenHash:  varchar("token_hash", { length: 128 }).notNull(),  // sha-256 of opaque token
    issuedAt:   timestamp("issued_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    expiresAt:  timestamp("expires_at").notNull(),
    revokedAt:  timestamp("revoked_at"),
    metadata:   jsonb("metadata").$type<{ userAgent?: string; ip?: string }>().notNull().default(sql`'{}'::jsonb`),
  },
  (t) => ({
    byUser:   index("sessions_user_idx").on(t.userId),
    byToken:  uniqueIndex("sessions_token_hash_idx").on(t.tokenHash),
    byExpiry: index("sessions_expires_at_idx").on(t.expiresAt),
  }),
);

export type Session = InferSelectModel<typeof sessions>;
