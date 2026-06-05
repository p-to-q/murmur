DROP INDEX IF EXISTS "purchases_status_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "purchases_user_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "purchases_provider_ref_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "ledger_external_ref_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "ledger_reason_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "ledger_user_idx";--> statement-breakpoint
ALTER TABLE "purchases" DROP CONSTRAINT IF EXISTS "purchases_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "notes_ledger" DROP CONSTRAINT IF EXISTS "notes_ledger_user_id_users_id_fk";--> statement-breakpoint
DROP TABLE IF EXISTS "purchases";--> statement-breakpoint
DROP TABLE IF EXISTS "notes_ledger";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "plan_tier";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "free_notes_granted_at";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "notes_balance";
