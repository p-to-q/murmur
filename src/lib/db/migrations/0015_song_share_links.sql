ALTER TABLE "songs"
ADD COLUMN IF NOT EXISTS "visibility" text NOT NULL DEFAULT 'private';
--> statement-breakpoint
ALTER TABLE "songs"
ADD COLUMN IF NOT EXISTS "share_code" text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'songs_visibility_check'
  ) THEN
    ALTER TABLE "songs"
      ADD CONSTRAINT "songs_visibility_check"
      CHECK ("visibility" IN ('private', 'unlisted', 'public'));
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "songs_share_code_idx"
ON "songs" USING btree ("share_code")
WHERE "share_code" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "songs_public_search_idx"
ON "songs" USING btree ("visibility", "created_at" DESC)
WHERE "visibility" = 'public';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "songs_visibility_idx"
ON "songs" USING btree ("visibility", "updated_at");
