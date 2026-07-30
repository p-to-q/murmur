CREATE TABLE IF NOT EXISTS "song_audio_objects" (
  "storage_key" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "song_id" text NOT NULL,
  "digest" varchar(64) NOT NULL,
  "state" varchar(24) DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp DEFAULT now() NOT NULL,
  "lease_until" timestamp,
  "last_error" text,
  "committed_at" timestamp,
  "deleted_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "song_audio_objects_due_idx"
  ON "song_audio_objects" USING btree ("state", "next_attempt_at", "lease_until");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "song_audio_objects_song_idx"
  ON "song_audio_objects" USING btree ("user_id", "song_id");
--> statement-breakpoint
INSERT INTO "song_audio_objects" (
  "storage_key",
  "user_id",
  "song_id",
  "digest",
  "state",
  "committed_at",
  "created_at",
  "updated_at"
)
SELECT
  "mp3_storage_key",
  "user_id",
  "id",
  CASE
    WHEN "mp3_storage_key" ~ '/[0-9a-f]{64}[-A-Za-z0-9_]*[.][A-Za-z0-9]+$'
      THEN substring("mp3_storage_key" from '/([0-9a-f]{64})[-A-Za-z0-9_]*[.][A-Za-z0-9]+$')
    ELSE repeat('0', 64)
  END,
  'committed',
  COALESCE("updated_at", "created_at", now()),
  COALESCE("created_at", now()),
  COALESCE("updated_at", now())
FROM "songs"
WHERE "mp3_storage_key" IS NOT NULL AND "mp3_storage_key" <> ''
ON CONFLICT ("storage_key") DO NOTHING;
