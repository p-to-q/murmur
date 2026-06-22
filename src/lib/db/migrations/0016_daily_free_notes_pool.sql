ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "daily_free_notes_balance" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE "users"
SET "daily_free_notes_balance" = 0
WHERE "daily_free_notes_balance" IS NULL;
--> statement-breakpoint
UPDATE "users"
SET "free_notes_granted_at" = TIMESTAMP '1970-01-01 00:00:00'
WHERE "account_kind" = 'registered'
  AND "daily_free_notes_balance" = 0;
