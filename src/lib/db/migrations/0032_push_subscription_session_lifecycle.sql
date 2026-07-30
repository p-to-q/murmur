UPDATE "push_subscriptions" AS "push"
SET
  "disabled_at" = COALESCE("push"."disabled_at", NOW()),
  "updated_at" = NOW()
WHERE "push"."disabled_at" IS NULL
  AND (
    "push"."session_id" IS NULL
    OR ("push"."expiration_time" IS NOT NULL AND "push"."expiration_time" <= NOW())
    OR NOT EXISTS (
      SELECT 1
      FROM "sessions" AS "session"
      WHERE "session"."id" = "push"."session_id"
        AND "session"."user_id" = "push"."user_id"
        AND "session"."revoked_at" IS NULL
        AND "session"."expires_at" > NOW()
    )
  );
--> statement-breakpoint
UPDATE "push_subscriptions" AS "push"
SET
  "session_id" = NULL,
  "updated_at" = NOW()
WHERE "push"."session_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "sessions" AS "session"
    WHERE "session"."id" = "push"."session_id"
      AND "session"."user_id" = "push"."user_id"
  );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_id_user_idx"
  ON "sessions" USING btree ("id", "user_id");
--> statement-breakpoint
ALTER TABLE "push_subscriptions"
  ADD CONSTRAINT "push_subscriptions_session_owner_fk"
  FOREIGN KEY ("session_id", "user_id")
  REFERENCES "public"."sessions"("id", "user_id")
  ON DELETE cascade
  ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "push_subscriptions"
  ADD CONSTRAINT "push_subscriptions_active_session_required_check"
  CHECK ("disabled_at" IS NOT NULL OR "session_id" IS NOT NULL);
