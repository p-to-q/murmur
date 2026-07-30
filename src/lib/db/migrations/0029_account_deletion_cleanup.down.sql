DROP TRIGGER IF EXISTS "users_account_deletion_job_trg" ON "users";
--> statement-breakpoint
DROP FUNCTION IF EXISTS "murmur_ensure_account_deletion_job"();
--> statement-breakpoint
DROP TABLE IF EXISTS "account_deletion_objects";
--> statement-breakpoint
DROP TABLE IF EXISTS "account_deletion_jobs";
