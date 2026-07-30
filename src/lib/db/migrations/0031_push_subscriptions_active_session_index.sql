CREATE INDEX IF NOT EXISTS "push_subscriptions_active_session_idx"
  ON "push_subscriptions" USING btree ("session_id")
  WHERE "disabled_at" IS NULL;
