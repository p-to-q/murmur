ALTER TABLE "songs" ADD COLUMN IF NOT EXISTS "artifact_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN IF NOT EXISTS "melody" jsonb;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN IF NOT EXISTS "provenance" jsonb;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN IF NOT EXISTS "save_fingerprint" text;
