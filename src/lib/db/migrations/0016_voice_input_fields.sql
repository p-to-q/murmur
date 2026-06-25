ALTER TABLE "songs" ADD COLUMN IF NOT EXISTS "mp3_url" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN IF NOT EXISTS "input_kind" text DEFAULT 'hum' NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN IF NOT EXISTS "lyrics" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN IF NOT EXISTS "generation_provider" text;
