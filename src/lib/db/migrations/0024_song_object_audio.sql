ALTER TABLE "songs" ADD COLUMN IF NOT EXISTS "mp3_url" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN IF NOT EXISTS "mp3_storage_key" text;
