-- Short links for per-post conversion tracking: admin creates slug→target,
-- /l/<slug> 302s to target and counts the click. UTMs live in the target URL
-- so the link posted on LinkedIn stays clean.
CREATE TABLE IF NOT EXISTS "short_links" (
	"slug" text PRIMARY KEY,
	"target" text NOT NULL,
	"clicks" integer NOT NULL DEFAULT 0,
	"created_at" timestamptz NOT NULL DEFAULT now()
);
