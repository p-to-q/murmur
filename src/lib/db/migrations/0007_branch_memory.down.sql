ALTER TABLE "songs"
DROP COLUMN IF EXISTS "lineage_depth";

ALTER TABLE "songs"
DROP COLUMN IF EXISTS "root_song_id";

ALTER TABLE "songs"
DROP COLUMN IF EXISTS "parent_song_id";
