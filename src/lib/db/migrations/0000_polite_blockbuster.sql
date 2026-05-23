CREATE TABLE "users" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"email" varchar(256),
	"name" text,
	"avatar_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "songs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"vibe" text NOT NULL,
	"vibe_en" text DEFAULT '' NOT NULL,
	"bpm" integer DEFAULT 80 NOT NULL,
	"key_signature" text DEFAULT 'C' NOT NULL,
	"scale_type" text DEFAULT 'major' NOT NULL,
	"duration" integer DEFAULT 0 NOT NULL,
	"mp3_data_url" text,
	"visual_config" jsonb NOT NULL,
	"arrangement_state" jsonb NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");