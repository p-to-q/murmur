DROP INDEX IF EXISTS "music_jobs_runnable_v2_idx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "music_jobs_runnable_idx"
  ON "music_jobs" USING btree ("status", "lease_until");
--> statement-breakpoint
ALTER TABLE "music_jobs" DROP COLUMN IF EXISTS "next_run_at";
--> statement-breakpoint
ALTER TABLE "music_jobs" DROP COLUMN IF EXISTS "deadline_at";
--> statement-breakpoint
ALTER TABLE "music_jobs" DROP COLUMN IF EXISTS "provider_submitted_at";
