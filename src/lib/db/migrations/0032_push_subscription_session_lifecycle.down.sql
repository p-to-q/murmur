ALTER TABLE "push_subscriptions"
  DROP CONSTRAINT IF EXISTS "push_subscriptions_active_session_required_check";
--> statement-breakpoint
ALTER TABLE "push_subscriptions"
  DROP CONSTRAINT IF EXISTS "push_subscriptions_session_owner_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "sessions_id_user_idx";
