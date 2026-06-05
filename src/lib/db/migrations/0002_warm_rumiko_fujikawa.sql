CREATE TABLE "notes_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"delta" integer NOT NULL,
	"reason" varchar(32) NOT NULL,
	"external_ref" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"provider" varchar(16) NOT NULL,
	"product_id" varchar(64) NOT NULL,
	"provider_ref" varchar(128) NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" varchar(8) NOT NULL,
	"notes_granted" integer NOT NULL,
	"status" varchar(16) NOT NULL,
	"raw_payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notes_balance" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "free_notes_granted_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan_tier" varchar(32) DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "notes_ledger" ADD CONSTRAINT "notes_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
UPDATE "users" SET "notes_balance" = 50, "plan_tier" = 'free';--> statement-breakpoint
INSERT INTO "notes_ledger" ("id", "user_id", "delta", "reason", "external_ref", "metadata")
SELECT
	'nle_cutover_' || md5("id"),
	"id",
	50,
	'grant:cutover_gift',
	'0002_warm_rumiko_fujikawa',
	'{"migration":"0002_warm_rumiko_fujikawa"}'::jsonb
FROM "users";--> statement-breakpoint
CREATE INDEX "ledger_user_idx" ON "notes_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_reason_idx" ON "notes_ledger" USING btree ("reason","created_at");--> statement-breakpoint
CREATE INDEX "ledger_external_ref_idx" ON "notes_ledger" USING btree ("external_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_provider_ref_idx" ON "purchases" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "purchases_user_idx" ON "purchases" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "purchases_status_idx" ON "purchases" USING btree ("status");
