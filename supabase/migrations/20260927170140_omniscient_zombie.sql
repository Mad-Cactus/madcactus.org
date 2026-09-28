-- IF EXISTS reconciliation: prod already dropped the video_* columns via
-- db:push. Harmless on fresh replays.
ALTER TABLE "outreach_prospects" DROP COLUMN IF EXISTS "video_url";--> statement-breakpoint
ALTER TABLE "outreach_prospects" DROP COLUMN IF EXISTS "video_description";--> statement-breakpoint
ALTER TABLE "outreach_prospects" DROP COLUMN IF EXISTS "video_view_count";--> statement-breakpoint
ALTER TABLE "outreach_prospects" DROP COLUMN IF EXISTS "video_first_viewed_at";--> statement-breakpoint
ALTER TABLE "outreach_prospects" DROP COLUMN IF EXISTS "video_last_viewed_at";--> statement-breakpoint
ALTER TABLE "outreach_prospects" DROP COLUMN IF EXISTS "video_watch_seconds";--> statement-breakpoint
ALTER TABLE "outreach_prospects" DROP COLUMN IF EXISTS "video_max_position";--> statement-breakpoint
ALTER TABLE "outreach_prospects" DROP COLUMN IF EXISTS "video_duration_seconds";--> statement-breakpoint
ALTER TABLE "outreach_prospects" DROP COLUMN IF EXISTS "video_completed";