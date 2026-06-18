CREATE TABLE IF NOT EXISTS "email_verification_codes" (
  "id"         text PRIMARY KEY,
  "email"      varchar(256) NOT NULL,
  "code"       varchar(6) NOT NULL,
  "expires_at" timestamp NOT NULL,
  "used_at"    timestamp,
  "attempts"   integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "evc_email_code_idx" ON "email_verification_codes" ("email", "code");
CREATE INDEX IF NOT EXISTS "evc_expires_at_idx" ON "email_verification_codes" ("expires_at");
