-- Rollback removes the daily-free pool column only. The up migration's
-- `free_notes_granted_at` reset is intentionally not reversible because it is
-- a launch cutover marker used to trigger the next lazy refill.
ALTER TABLE "users"
DROP COLUMN IF EXISTS "daily_free_notes_balance";
