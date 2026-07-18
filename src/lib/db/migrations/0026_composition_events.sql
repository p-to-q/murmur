CREATE TABLE IF NOT EXISTS "composition_events" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" varchar(128) NOT NULL,
  "song_id" text,
  "draft_id" text,
  "flow_id" text,
  "generation_batch_id" text,
  "generation_clip_id" text,
  "event_kind" varchar(48) NOT NULL,
  "source" varchar(32) DEFAULT 'server' NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "occurred_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "composition_events" ADD CONSTRAINT "composition_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "composition_events" ADD CONSTRAINT "composition_events_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "composition_events_user_time_idx" ON "composition_events" USING btree ("user_id","occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "composition_events_song_time_idx" ON "composition_events" USING btree ("song_id","occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "composition_events_draft_time_idx" ON "composition_events" USING btree ("draft_id","occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "composition_events_generation_batch_idx" ON "composition_events" USING btree ("generation_batch_id","occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "composition_events_kind_time_idx" ON "composition_events" USING btree ("event_kind","occurred_at");
