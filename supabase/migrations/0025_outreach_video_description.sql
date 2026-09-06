ALTER TABLE "outreach_prospects" DROP CONSTRAINT "outreach_stage_check";--> statement-breakpoint
ALTER TABLE "outreach_prospects" ALTER COLUMN "stage" SET DEFAULT 'proposed';--> statement-breakpoint
ALTER TABLE "outreach_prospects" ADD COLUMN "video_description" text;--> statement-breakpoint
ALTER TABLE "outreach_prospects" ADD CONSTRAINT "outreach_stage_check" CHECK ("outreach_prospects"."stage" in ('proposed', 'sent', 'watching', 'replied', 'meeting', 'won', 'shutdown'));