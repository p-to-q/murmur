DROP INDEX IF EXISTS "songs_visibility_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "songs_public_search_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "songs_share_code_idx";
--> statement-breakpoint
ALTER TABLE "songs"
DROP CONSTRAINT IF EXISTS "songs_visibility_check";
--> statement-breakpoint
ALTER TABLE "songs"
DROP COLUMN IF EXISTS "share_code";
--> statement-breakpoint
ALTER TABLE "songs"
DROP COLUMN IF EXISTS "visibility";
