/**
 * notes_ledger — the audit trail for every notes balance change.
 *
 * Authoritative reference: docs/data-model.md §3.4.
 *
 * Invariant: SUM(delta WHERE user_id = U) == users.notes_balance. Spend +
 * grant + refund are all rows; refunds are negative-delta grants. No row
 * is ever updated or deleted.
 *
 * Registered in schema/index.ts as the Phase 4 billing substrate.
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

export const notesLedger = pgTable(
  "notes_ledger",
  {
    id:          text("id").primaryKey(),                  // ulid `nle_…`
    userId:      varchar("user_id", { length: 128 }).notNull().references(() => users.id, { onDelete: "cascade" }),
    delta:       integer("delta").notNull(),               // signed
    reason:      varchar("reason", { length: 32 }).notNull(),
    externalRef: text("external_ref"),                     // tx id, song id, …
    metadata:    jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt:   timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    byUser:        index("ledger_user_idx").on(t.userId, t.createdAt),
    byReason:      index("ledger_reason_idx").on(t.reason, t.createdAt),
    byExternalRef: index("ledger_external_ref_idx").on(t.externalRef),
    // Idempotency: (user_id, reason, external_ref) must be unique
    // whenever external_ref is supplied. Webhook retries, request-id
    // replays, and refund/grant flows all rely on this to make
    // duplicate writes a DB-level error class, not a balance-mutation
    // class. Partial because most rows (e.g. spend with no externalRef)
    // do not participate in idempotency.
    idempotency:   uniqueIndex("ledger_idempotency_idx")
      .on(t.userId, t.reason, t.externalRef)
      .where(sql`${t.externalRef} IS NOT NULL`),
  }),
);

export type NotesLedgerEntry = InferSelectModel<typeof notesLedger>;
