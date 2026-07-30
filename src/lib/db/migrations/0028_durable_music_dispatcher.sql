ALTER TABLE "music_jobs" ADD COLUMN IF NOT EXISTS "provider_submitted_at" timestamp;
--> statement-breakpoint
ALTER TABLE "music_jobs" ADD COLUMN IF NOT EXISTS "deadline_at" timestamp;
--> statement-breakpoint
ALTER TABLE "music_jobs" ADD COLUMN IF NOT EXISTS "next_run_at" timestamp;
--> statement-breakpoint
UPDATE "music_jobs"
SET
  "deadline_at" = COALESCE("deadline_at", "created_at" + interval '15 minutes'),
  "next_run_at" = CASE
    WHEN "status" IN ('accepted', 'queued', 'running', 'cancel_requested', 'result_ready')
      THEN COALESCE("next_run_at", now())
    ELSE "next_run_at"
  END;
--> statement-breakpoint
ALTER TABLE "music_jobs" ALTER COLUMN "deadline_at" SET NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "music_jobs_runnable_idx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "music_jobs_runnable_v2_idx"
  ON "music_jobs" USING btree ("status", "next_run_at", "lease_until");
