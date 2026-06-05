DROP INDEX IF EXISTS "users_region_id_idx";
ALTER TABLE "users" DROP COLUMN IF EXISTS "region_id";
ALTER TABLE "songs" ALTER COLUMN "scale_type" SET DEFAULT 'major';
