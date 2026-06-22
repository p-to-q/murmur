ALTER TABLE "external_identities"
  DROP CONSTRAINT IF EXISTS "external_identities_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "external_identities"
  ALTER COLUMN "user_id" TYPE text;
