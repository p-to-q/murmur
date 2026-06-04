/**
 * purchases — provider-confirmed top-up records.
 *
 * Authoritative reference: docs/data-model.md §3.5.
 *
 * Lifecycle: pending → succeeded | failed → refunded?
 * Webhook routes write here; client never does.
 *
 * Registered in schema/index.ts as the Phase 4 billing substrate.
 */

import { pgTable, text, integer, varchar, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import type { InferSelectModel } from "drizzle-orm";
import { users } from "./users";

export const purchases = pgTable(
  "purchases",
  {
    id:           text("id").primaryKey(),                          // ulid `pur_…`
    userId:       varchar("user_id", { length: 128 }).notNull().references(() => users.id, { onDelete: "cascade" }),
    provider:     varchar("provider", { length: 16 }).notNull(),    // stripe | wechat_pay | apple_iap | google_play | revenuecat
    productId:    varchar("product_id", { length: 64 }).notNull(),  // SKU id
    providerRef:  varchar("provider_ref", { length: 128 }).notNull(), // provider's transaction id
    amountCents:  integer("amount_cents").notNull(),
    currency:     varchar("currency", { length: 8 }).notNull(),     // USD | CNY
    notesGranted: integer("notes_granted").notNull(),
    status:       varchar("status", { length: 16 }).notNull(),      // pending | succeeded | refunded | failed
    rawPayload:   jsonb("raw_payload"),
    createdAt:    timestamp("created_at").notNull().defaultNow(),
    updatedAt:    timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueProviderRef: uniqueIndex("purchases_provider_ref_idx").on(t.provider, t.providerRef),
    byUser:            index("purchases_user_idx").on(t.userId, t.createdAt),
    byStatus:          index("purchases_status_idx").on(t.status),
  }),
);

export type Purchase = InferSelectModel<typeof purchases>;
