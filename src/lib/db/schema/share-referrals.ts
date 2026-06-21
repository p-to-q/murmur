/**
 * share_referrals — durable attribution for invite-link registration rewards.
 *
 * The notes ledger remains the balance audit trail. This table records the
 * product-level referral relationship so one invitee can only ever settle once
 * and operators can inspect who invited whom without reverse-engineering
 * ledger metadata.
 */

import {
  pgTable,
  text,
  integer,
  varchar,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { users } from "./users";

export const shareReferrals = pgTable(
  "share_referrals",
  {
    id:               text("id").primaryKey(), // ulid `srf_...`
    referrerUserId:   varchar("referrer_user_id", { length: 128 }).notNull().references(() => users.id, { onDelete: "cascade" }),
    inviteeUserId:    varchar("invitee_user_id", { length: 128 }).notNull().references(() => users.id, { onDelete: "cascade" }),
    status:           varchar("status", { length: 16 }).notNull().default("settled"),
    source:           varchar("source", { length: 32 }).notNull(),
    registrationKind: varchar("registration_kind", { length: 32 }).notNull(),
    rewardNotes:      integer("reward_notes").notNull(),
    referrerLedgerId: text("referrer_ledger_id"),
    inviteeLedgerId:  text("invitee_ledger_id"),
    metadata:         jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt:        timestamp("created_at").notNull().defaultNow(),
    settledAt:        timestamp("settled_at"),
  },
  (t) => ({
    byReferrer:    index("share_referrals_referrer_idx").on(t.referrerUserId, t.createdAt),
    byStatus:      index("share_referrals_status_idx").on(t.status, t.createdAt),
    uniqueInvitee: uniqueIndex("share_referrals_invitee_idx").on(t.inviteeUserId),
  }),
);

export type ShareReferral = InferSelectModel<typeof shareReferrals>;
