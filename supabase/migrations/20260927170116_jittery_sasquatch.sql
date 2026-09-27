CREATE TABLE "videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"url" text NOT NULL,
	"storage_path" text,
	"status" text DEFAULT 'unwatched' NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"first_viewed_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"watch_seconds" integer DEFAULT 0 NOT NULL,
	"max_position" integer DEFAULT 0 NOT NULL,
	"duration_seconds" integer,
	"completed" boolean DEFAULT false NOT NULL,
	"prospect_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_status_check" CHECK ("videos"."status" in ('unwatched', 'watching', 'watched', 'completed'))
);
--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_prospect_id_outreach_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."outreach_prospects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_videos_prospect" ON "videos" USING btree ("prospect_id");