/**
 * external_identities — OAuth / openid identity links per user.
 *
 * Authoritative reference: docs/data-model.md §3.2 + docs/user-model.md §3.
 *
 * (provider, externalId) is unique globally — the same Apple ID cannot
 * bind to two `users` rows. Users may have multiple identities (linking).
 *
 * NOT YET registered in schema/index.ts — Codex registers + migrates
 * in Phase 3 of docs/execution-roadmap.md.
 */

import { pgTable, text, varchar, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

export const externalIdentities = pgTable(
  "external_identities",
  {
    id:         text("id").primaryKey(),                            // ulid `eid_…`
    userId:     text("user_id").notNull(),                          // FK -> users.id (cascade)
    provider:   varchar("provider", { length: 16 }).notNull(),      // apple | google | wechat | wechat_mp | email
    externalId: varchar("external_id", { length: 256 }).notNull(),  // sub | openid | email
    linkedAt:   timestamp("linked_at").notNull().defaultNow(),
    metadata:   jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  },
  (t) => ({
    uniqueIdentity: uniqueIndex("ext_id_provider_external_idx").on(t.provider, t.externalId),
    byUser:         index("ext_id_user_idx").on(t.userId),
  }),
);

export type ExternalIdentity = InferSelectModel<typeof externalIdentities>;
