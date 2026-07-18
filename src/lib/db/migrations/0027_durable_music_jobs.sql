CREATE TABLE IF NOT EXISTS "music_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" varchar(128) NOT NULL,
  "operation_id" varchar(128) NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "status" varchar(32) DEFAULT 'accepted' NOT NULL,
  "input" jsonb NOT NULL,
  "output" jsonb,
  "provider" varchar(32),
  "provider_job_id" text,
  "spend_ledger_id" text,
  "attempt" integer DEFAULT 0 NOT NULL,
  "lease_until" timestamp,
  "cancel_requested_at" timestamp,
  "error_code" varchar(64),
  "error_message" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "started_at" timestamp,
  "finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "music_jobs" ADD CONSTRAINT "music_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "music_jobs" ADD CONSTRAINT "music_jobs_spend_ledger_id_notes_ledger_id_fk" FOREIGN KEY ("spend_ledger_id") REFERENCES "public"."notes_ledger"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "music_jobs_user_operation_uidx" ON "music_jobs" USING btree ("user_id","operation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "music_jobs_user_time_idx" ON "music_jobs" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "music_jobs_runnable_idx" ON "music_jobs" USING btree ("status","lease_until");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "music_jobs_provider_job_uidx" ON "music_jobs" USING btree ("provider","provider_job_id") WHERE "provider_job_id" IS NOT NULL;
