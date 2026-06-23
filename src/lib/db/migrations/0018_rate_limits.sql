CREATE TABLE IF NOT EXISTS "rate_limits" (
  "bucket_key" text PRIMARY KEY,
  "tokens" double precision NOT NULL,
  "updated_at" timestamp NOT NULL,
  "expires_at" timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS "rate_limits_expires_at_idx"
ON "rate_limits" USING btree ("expires_at");
