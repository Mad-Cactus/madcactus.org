ALTER TABLE "outreach_prospects" ADD COLUMN "video_max_position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_prospects" ADD COLUMN "video_duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "outreach_prospects" ADD COLUMN "video_completed" boolean DEFAULT false NOT NULL;