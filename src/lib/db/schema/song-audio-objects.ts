import type { InferSelectModel } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export type SongAudioObjectState =
  | "pending"
  | "committed"
  | "delete_pending"
  | "deleted";

/** Durable ownership state for song masters stored outside Postgres. */
export const songAudioObjects = pgTable(
  "song_audio_objects",
  {
    storageKey: text("storage_key").primaryKey(),
    userId: text("user_id").notNull(),
    songId: text("song_id").notNull(),
    digest: varchar("digest", { length: 64 }).notNull(),
    state: varchar("state", { length: 24 })
      .notNull()
      .$type<SongAudioObjectState>()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
    leaseUntil: timestamp("lease_until"),
    lastError: text("last_error"),
    committedAt: timestamp("committed_at"),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    due: index("song_audio_objects_due_idx").on(
      table.state,
      table.nextAttemptAt,
      table.leaseUntil,
    ),
    song: index("song_audio_objects_song_idx").on(table.userId, table.songId),
  }),
);

export type SongAudioObject = InferSelectModel<typeof songAudioObjects>;
