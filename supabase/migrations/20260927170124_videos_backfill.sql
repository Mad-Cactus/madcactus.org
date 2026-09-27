-- Backfill: every prospect with a video_url gets a videos row carrying its
-- telemetry; the video owns prospect_id. Runs BETWEEN the two generated
-- migrations that (1) create the videos table and (3) drop the prospect
-- video columns — filename order enforces that.
-- idempotent-ish: backfilled rows keep the prospect's id as their own id, so
-- a replayed run re-inserts the same PK (ON CONFLICT DO NOTHING) instead of
-- duplicating. Legacy /v/<prospect-uuid> email links keep working because
-- the watch route falls back to prospect lookup.
INSERT INTO "videos" (
	"id", "title", "description", "url", "status", "view_count",
	"first_viewed_at", "last_viewed_at", "watch_seconds", "max_position",
	"duration_seconds", "completed", "prospect_id", "created_at", "updated_at"
)
SELECT
	p."id",
	coalesce(nullif(p."video_description", ''), 'Outreach video — ' || p."company"),
	p."video_description",
	p."video_url",
	CASE
		WHEN p."video_completed" THEN 'completed'
		WHEN p."video_watch_seconds" > 0 OR p."video_max_position" > 0 THEN 'watched'
		WHEN p."video_first_viewed_at" IS NOT NULL THEN 'watching'
		ELSE 'unwatched'
	END,
	p."video_view_count",
	p."video_first_viewed_at",
	p."video_last_viewed_at",
	p."video_watch_seconds",
	p."video_max_position",
	p."video_duration_seconds",
	p."video_completed",
	p."id",
	p."created_at",
	coalesce(p."updated_at", p."created_at")
FROM "outreach_prospects" p
WHERE p."video_url" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;
