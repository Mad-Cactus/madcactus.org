CREATE TABLE "slack_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slack_id" text NOT NULL,
	"name" text NOT NULL,
	"purpose" text DEFAULT '' NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"last_sync_at" timestamp with time zone,
	CONSTRAINT "slack_channels_slack_id_unique" UNIQUE("slack_id")
);
--> statement-breakpoint
CREATE TABLE "slack_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"ts" text NOT NULL,
	"thread_ts" text,
	"user_id" text,
	"user_name" text DEFAULT '' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"is_bot" boolean DEFAULT false NOT NULL,
	"message_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slack_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"real_name" text DEFAULT '' NOT NULL,
	"email" text,
	"is_bot" boolean DEFAULT false NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slack_users_slack_id_unique" UNIQUE("slack_id")
);
--> statement-breakpoint
ALTER TABLE "brain_facts" ADD COLUMN "surface" text;--> statement-breakpoint
ALTER TABLE "slack_messages" ADD CONSTRAINT "slack_messages_channel_id_slack_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."slack_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slack_messages_channel_ts_uq" ON "slack_messages" USING btree ("channel_id","ts");--> statement-breakpoint
CREATE INDEX "idx_slack_messages_date" ON "slack_messages" USING btree ("message_at");