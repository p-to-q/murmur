CREATE TABLE IF NOT EXISTS "events_webhook" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" varchar(16) NOT NULL,
	"provider_event_id" varchar(128) NOT NULL,
	"route_id" varchar(64) NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"status" varchar(16) NOT NULL,
	"signature_ok" boolean NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "events_webhook_provider_event_idx" ON "events_webhook" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_webhook_status_idx" ON "events_webhook" USING btree ("status","received_at");