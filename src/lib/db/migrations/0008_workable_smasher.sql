CREATE TABLE "external_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" varchar(16) NOT NULL,
	"external_id" varchar(256) NOT NULL,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "parent_song_id" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "root_song_id" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "lineage_depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "source_melody_kind" text DEFAULT 'corrected' NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "edit_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "edit_depth" text DEFAULT 'fresh' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ext_id_provider_external_idx" ON "external_identities" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "ext_id_user_idx" ON "external_identities" USING btree ("user_id");