ALTER TABLE "external_identities"
  ALTER COLUMN "user_id" TYPE varchar(128);
--> statement-breakpoint
DELETE FROM "external_identities" ei
WHERE NOT EXISTS (
  SELECT 1
  FROM "users" u
  WHERE u."id" = ei."user_id"
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'external_identities_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "external_identities"
      ADD CONSTRAINT "external_identities_user_id_users_id_fk"
      FOREIGN KEY ("user_id")
      REFERENCES "users"("id")
      ON DELETE cascade;
  END IF;
END $$;
