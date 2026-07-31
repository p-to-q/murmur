import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

import { songs } from "./songs";
import { users } from "./users";

export type CompositionEventKind =
  | "generation.completed"
  | "song.saved"
  | "song.shared"
  | "song.exported"
  | "song.feedback";

export type CompositionEventPayload = Record<string, unknown>;

export const compositionEvents = pgTable(
  "composition_events",
  {
    id: text("id").primaryKey(),
    userId: varchar("user_id", { length: 128 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    songId: text("song_id").references(() => songs.id, { onDelete: "set null" }),
    draftId: text("draft_id"),
    flowId: text("flow_id"),
    generationBatchId: text("generation_batch_id"),
    generationClipId: text("generation_clip_id"),
    eventKind: varchar("event_kind", { length: 48 }).notNull().$type<CompositionEventKind>(),
    source: varchar("source", { length: 32 }).notNull().default("server"),
    payload: jsonb("payload").$type<CompositionEventPayload>().notNull().default(sql`'{}'::jsonb`),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    byUserTime: index("composition_events_user_time_idx").on(t.userId, t.occurredAt),
    bySongTime: index("composition_events_song_time_idx").on(t.songId, t.occurredAt),
    byDraftTime: index("composition_events_draft_time_idx").on(t.draftId, t.occurredAt),
    byGenerationBatch: index("composition_events_generation_batch_idx").on(
      t.generationBatchId,
      t.occurredAt,
    ),
    byKindTime: index("composition_events_kind_time_idx").on(t.eventKind, t.occurredAt),
  }),
);

export type CompositionEvent = InferSelectModel<typeof compositionEvents>;
