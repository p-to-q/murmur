DROP INDEX IF EXISTS "push_subscriptions_endpoint_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "push_subscriptions_active_user_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "push_subscriptions_user_idx";
--> statement-breakpoint
ALTER TABLE "push_subscriptions" DROP CONSTRAINT IF EXISTS "push_subscriptions_user_id_users_id_fk";
--> statement-breakpoint
DROP TABLE IF EXISTS "push_subscriptions";
