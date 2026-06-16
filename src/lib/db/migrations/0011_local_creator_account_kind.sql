ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "account_kind" varchar(32) DEFAULT 'registered' NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "promoted_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_account_kind_idx" ON "users" USING btree ("account_kind");
