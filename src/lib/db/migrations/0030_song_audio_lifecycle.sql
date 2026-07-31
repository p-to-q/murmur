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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "murmur_track_legacy_song_audio"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_key text;
  new_key text;
BEGIN
  old_key := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD."mp3_storage_key" ELSE NULL END;
  new_key := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW."mp3_storage_key" ELSE NULL END;

  IF old_key IS NOT NULL AND old_key <> ''
     AND (TG_OP = 'DELETE' OR new_key IS DISTINCT FROM old_key) THEN
    INSERT INTO "song_audio_objects" (
      "storage_key", "user_id", "song_id", "digest", "state",
      "next_attempt_at", "created_at", "updated_at"
    ) VALUES (
      old_key, OLD."user_id", OLD."id",
      CASE
        WHEN old_key ~ '/[0-9a-f]{64}[-A-Za-z0-9_]*[.][A-Za-z0-9]+$'
          THEN substring(old_key from '/([0-9a-f]{64})[-A-Za-z0-9_]*[.][A-Za-z0-9]+$')
        ELSE repeat('0', 64)
      END,
      'delete_pending', now(), now(), now()
    )
    ON CONFLICT ("storage_key") DO UPDATE SET
      "state" = 'delete_pending',
      "next_attempt_at" = now(),
      "lease_until" = NULL,
      "last_error" = NULL,
      "updated_at" = now();
  END IF;

  IF new_key IS NOT NULL AND new_key <> ''
     AND (TG_OP = 'INSERT' OR new_key IS DISTINCT FROM old_key) THEN
    INSERT INTO "song_audio_objects" (
      "storage_key", "user_id", "song_id", "digest", "state",
      "next_attempt_at", "committed_at", "created_at", "updated_at"
    ) VALUES (
      new_key, NEW."user_id", NEW."id",
      CASE
        WHEN new_key ~ '/[0-9a-f]{64}[-A-Za-z0-9_]*[.][A-Za-z0-9]+$'
          THEN substring(new_key from '/([0-9a-f]{64})[-A-Za-z0-9_]*[.][A-Za-z0-9]+$')
        ELSE repeat('0', 64)
      END,
      'committed', now(), now(), now(), now()
    )
    ON CONFLICT ("storage_key") DO UPDATE SET
      "state" = 'committed',
      "next_attempt_at" = now(),
      "lease_until" = NULL,
      "last_error" = NULL,
      "committed_at" = COALESCE("song_audio_objects"."committed_at", now()),
      "deleted_at" = NULL,
      "updated_at" = now();
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "songs_audio_lifecycle_trg" ON "songs";
--> statement-breakpoint
CREATE TRIGGER "songs_audio_lifecycle_trg"
AFTER INSERT OR UPDATE OF "mp3_storage_key" OR DELETE ON "songs"
FOR EACH ROW
EXECUTE FUNCTION "murmur_track_legacy_song_audio"();
