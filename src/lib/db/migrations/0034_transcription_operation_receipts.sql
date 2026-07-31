CREATE TABLE "transcription_operations" (
  "user_id" varchar(128) NOT NULL,
  "operation_id" varchar(128) NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "status" varchar(24) DEFAULT 'processing' NOT NULL,
  "result" jsonb,
  "spend_ledger_id" text,
  "lease_epoch" integer DEFAULT 0 NOT NULL,
  "lease_until" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "finished_at" timestamp,
  CONSTRAINT "transcription_operations_pkey" PRIMARY KEY("user_id", "operation_id")
);
--> statement-breakpoint
ALTER TABLE "transcription_operations"
  ADD CONSTRAINT "transcription_operations_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transcription_operations"
  ADD CONSTRAINT "transcription_operations_spend_ledger_id_notes_ledger_id_fk"
  FOREIGN KEY ("spend_ledger_id") REFERENCES "public"."notes_ledger"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "transcription_operations_status_lease_idx"
  ON "transcription_operations" USING btree ("status", "lease_until");
