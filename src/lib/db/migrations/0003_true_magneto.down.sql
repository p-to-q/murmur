DROP INDEX IF EXISTS "sessions_expires_at_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "sessions_token_hash_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "sessions_user_idx";--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_user_id_users_id_fk";--> statement-breakpoint
DROP TABLE IF EXISTS "sessions";
