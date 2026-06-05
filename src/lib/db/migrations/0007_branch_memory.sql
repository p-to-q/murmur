ALTER TABLE "songs"
ADD COLUMN "parent_song_id" text;

ALTER TABLE "songs"
ADD COLUMN "root_song_id" text;

ALTER TABLE "songs"
ADD COLUMN "lineage_depth" integer NOT NULL DEFAULT 0;
