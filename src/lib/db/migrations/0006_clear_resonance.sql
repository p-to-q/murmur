ALTER TABLE "songs"
ADD COLUMN "edit_count" integer NOT NULL DEFAULT 0;

ALTER TABLE "songs"
ADD COLUMN "edit_depth" text NOT NULL DEFAULT 'fresh';
