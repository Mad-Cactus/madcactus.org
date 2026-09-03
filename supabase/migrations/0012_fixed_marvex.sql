ALTER TABLE "outreach_prospects" ADD COLUMN "video_view_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_prospects" ADD COLUMN "video_first_viewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outreach_prospects" ADD COLUMN "video_last_viewed_at" timestamp with time zone;