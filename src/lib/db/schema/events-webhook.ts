/**
 * events_webhook — every webhook payload received from a billing provider.
 *
 * Authoritative reference: docs/data-model.md §3.7 + docs/api-conventions.md §10.
 *
 * Used to:
 *   1. Verify signatures BEFORE processing.
 *   2. Detect duplicate provider events (idempotency on providerEventId).
 *   3. Forensic replay when a webhook causes a ledger anomaly.
 *
 * Retention: 90 days (job-driven).
 *
 * NOT YET registered in schema/index.ts — Codex registers + migrates
 * in Phase 4 of docs/execution-roadmap.md.
 */

import { pgTable, text, varchar, timestamp, jsonb, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import type { InferSelectModel } from "drizzle-orm";

export const eventsWebhook = pgTable(
  "events_webhook",
  {
    id:              text("id").primaryKey(),                            // ulid `evw_…`
    provider:        varchar("provider", { length: 16 }).notNull(),
    providerEventId: varchar("provider_event_id", { length: 128 }).notNull(),
    routeId:         varchar("route_id", { length: 64 }).notNull(),      // e.g. "billing.webhook.stripe"
    receivedAt:      timestamp("received_at").notNull().defaultNow(),
    processedAt:     timestamp("processed_at"),
    status:          varchar("status", { length: 16 }).notNull(),        // received | processed | failed | duplicate
    signatureOk:     boolean("signature_ok").notNull(),
    rawPayload:      jsonb("raw_payload").notNull(),
    error:           text("error"),
  },
  (t) => ({
    uniqueEvent: uniqueIndex("events_webhook_provider_event_idx").on(t.provider, t.providerEventId),
    byStatus:    index("events_webhook_status_idx").on(t.status, t.receivedAt),
  }),
);

export type EventWebhook = InferSelectModel<typeof eventsWebhook>;
