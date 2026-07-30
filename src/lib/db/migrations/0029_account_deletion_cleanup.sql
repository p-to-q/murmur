CREATE TABLE IF NOT EXISTS "account_deletion_jobs" (
  "user_id" varchar(128) PRIMARY KEY NOT NULL,
  "status" varchar(24) DEFAULT 'pending' NOT NULL,
  "requested_at" timestamp NOT NULL,
  "purge_after" timestamp NOT NULL,
  "next_attempt_at" timestamp NOT NULL,
  "lease_until" timestamp,
  "attempts" integer DEFAULT 0 NOT NULL,
  "objects_deleted" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "account_deletion_jobs_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_deletion_jobs_due_idx"
  ON "account_deletion_jobs" USING btree ("status", "next_attempt_at", "lease_until");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account_deletion_objects" (
  "user_id" varchar(128) NOT NULL,
  "storage_key" text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp DEFAULT now() NOT NULL,
  "last_error" text,
  "deleted_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "account_deletion_objects_user_id_storage_key_pk"
    PRIMARY KEY ("user_id", "storage_key"),
  CONSTRAINT "account_deletion_objects_user_id_account_deletion_jobs_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."account_deletion_jobs"("user_id")
    ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_deletion_objects_due_idx"
  ON "account_deletion_objects" USING btree ("user_id", "deleted_at", "next_attempt_at");
--> statement-breakpoint
INSERT INTO "account_deletion_jobs" (
  "user_id",
  "status",
  "requested_at",
  "purge_after",
  "next_attempt_at"
)
SELECT
  "id",
  'pending',
  "deleted_at",
  "deleted_at" + interval '30 days',
  "deleted_at" + interval '30 days'
FROM "users"
WHERE "deleted_at" IS NOT NULL
ON CONFLICT ("user_id") DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "murmur_ensure_account_deletion_job"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."deleted_at" IS NOT NULL AND OLD."deleted_at" IS NULL THEN
    INSERT INTO "account_deletion_jobs" (
      "user_id",
      "status",
      "requested_at",
      "purge_after",
      "next_attempt_at"
    ) VALUES (
      NEW."id",
      'pending',
      NEW."deleted_at",
      NEW."deleted_at" + interval '30 days',
      NEW."deleted_at" + interval '30 days'
    )
    ON CONFLICT ("user_id") DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "users_account_deletion_job_trg" ON "users";
--> statement-breakpoint
CREATE TRIGGER "users_account_deletion_job_trg"
AFTER UPDATE OF "deleted_at" ON "users"
FOR EACH ROW
EXECUTE FUNCTION "murmur_ensure_account_deletion_job"();
