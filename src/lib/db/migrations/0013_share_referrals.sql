CREATE TABLE IF NOT EXISTS "share_referrals" (
  "id" text PRIMARY KEY,
  "referrer_user_id" varchar(128) NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "invitee_user_id" varchar(128) NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "status" varchar(16) NOT NULL DEFAULT 'settled',
  "source" varchar(32) NOT NULL,
  "registration_kind" varchar(32) NOT NULL,
  "reward_notes" integer NOT NULL,
  "referrer_ledger_id" text,
  "invitee_ledger_id" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "settled_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "share_referrals_referrer_idx" ON "share_referrals" USING btree ("referrer_user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "share_referrals_status_idx" ON "share_referrals" USING btree ("status", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "share_referrals_invitee_idx" ON "share_referrals" USING btree ("invitee_user_id");
