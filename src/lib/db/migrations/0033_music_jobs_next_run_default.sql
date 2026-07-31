-- Keep jobs created by the pre-dispatcher app runnable throughout the
-- migrate-before-deploy and app-only rollback compatibility window.
ALTER TABLE "music_jobs" ALTER COLUMN "next_run_at" SET DEFAULT now();

-- Dispatcher discovery already treats NULL as due. Persist that state for rows
-- accepted during an earlier app/migration skew so every scheduler agrees on
-- the same runnable set.
UPDATE "music_jobs"
SET "next_run_at" = now()
WHERE "next_run_at" IS NULL
  AND "status" IN (
    'accepted',
    'submitting',
    'queued',
    'running',
    'result_ready',
    'cancel_requested'
  );
