ALTER TABLE "songs" ALTER COLUMN "scale_type" SET DEFAULT 'minor';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "region_id" varchar(8) DEFAULT 'intl' NOT NULL;--> statement-breakpoint
CREATE INDEX "users_region_id_idx" ON "users" USING btree ("region_id");
