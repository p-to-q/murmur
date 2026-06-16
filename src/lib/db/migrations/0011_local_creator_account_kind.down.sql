DROP INDEX IF EXISTS "users_account_kind_idx";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "promoted_at";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "account_kind";
