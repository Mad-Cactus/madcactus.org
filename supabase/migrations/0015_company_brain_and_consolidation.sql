CREATE TYPE "public"."doc_status" AS ENUM('draft', 'final');--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"company_id" uuid,
	"content" text NOT NULL,
	"status" text DEFAULT 'generating' NOT NULL,
	"model" text,
	"last_error" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "text_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"author" text DEFAULT 'human' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "status" "doc_status" DEFAULT 'final' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "loro_snapshot" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memories_scope_company_uq" ON "memories" USING btree ("scope",coalesce("company_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "idx_memories_company" ON "memories" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "text_versions_entity_ver_idx" ON "text_versions" USING btree ("entity","entity_id","version");--> statement-breakpoint
-- ── Data migration: preserve the voice-learning corpus as a doc ──
-- The redline tables hold derived lessons + lint patterns from real
-- agent-draft → human-edit diffs. They move into a "Voice lessons" doc so
-- the brain's generation loop and search keep using them after the tables
-- die. The text_versions backfill (below) seeds the diff history too.
INSERT INTO "docs" ("title", "markdown", "status")
SELECT
	'Voice lessons',
	'# Voice lessons' || E'\n\n' ||
	'Collin''s writing rules, derived from real agent-draft → human-edit diffs. Read before drafting any email or doc for Collin.' || E'\n\n' ||
	'## Lessons' || E'\n\n' ||
	COALESCE((SELECT string_agg(
		'- ' || replace(lesson, E'\n', ' ') ||
		CASE
			WHEN tags IS NOT NULL AND tags LIKE '[%' THEN
				' _[' || (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(tags::jsonb) AS x) || ']_'
			WHEN tags IS NOT NULL AND tags <> '' THEN ' _[' || tags || ']_'
			ELSE ''
		END,
		E'\n' ORDER BY created_at)
	FROM redline_lessons), '') ||
	E'\n\n' || '## Machine rules (legacy lint patterns)' || E'\n\n' ||
	COALESCE((SELECT string_agg(
		'- **' || direction || ':** ' || replace(rule, E'\n', ' ') ||
		' — pattern: `' || pattern || '` (' || pattern_type || ', ' || confidence || ')',
		E'\n' ORDER BY created_at)
	FROM redline_patterns), ''),
	'final'
WHERE NOT EXISTS (SELECT 1 FROM "docs" WHERE "title" = 'Voice lessons');--> statement-breakpoint
-- Seed text_versions: every doc and every non-empty outbox draft gets its
-- current body as version 1, so diffs have a base to diff against.
INSERT INTO "text_versions" ("entity", "entity_id", "version", "author", "content")
SELECT 'doc', d."id", 1, 'agent', d."markdown"
FROM "docs" d
WHERE d."markdown" <> '' AND NOT EXISTS (
	SELECT 1 FROM "text_versions" tv WHERE tv."entity" = 'doc' AND tv."entity_id" = d."id"
);--> statement-breakpoint
INSERT INTO "text_versions" ("entity", "entity_id", "version", "author", "content")
SELECT 'email_draft', o."id", 1, 'agent', o."body"
FROM "email_outbox" o
WHERE o."status" = 'draft' AND o."body" <> '' AND NOT EXISTS (
	SELECT 1 FROM "text_versions" tv WHERE tv."entity" = 'email_draft' AND tv."entity_id" = o."id"
);--> statement-breakpoint
DROP TABLE "redline_derivation_jobs" CASCADE;--> statement-breakpoint
DROP TABLE "redline_drafts" CASCADE;--> statement-breakpoint
DROP TABLE "redline_lessons" CASCADE;--> statement-breakpoint
DROP TABLE "redline_pairs" CASCADE;--> statement-breakpoint
DROP TABLE "redline_patterns" CASCADE;--> statement-breakpoint
DROP TABLE "redline_revisions" CASCADE;--> statement-breakpoint
ALTER TABLE "docs" DROP COLUMN "last_agent_content";--> statement-breakpoint
ALTER TABLE "email_outbox" DROP COLUMN "draft_id";--> statement-breakpoint
ALTER TABLE "email_outbox" DROP COLUMN "pair_id";--> statement-breakpoint
DROP TYPE "public"."redline_author";--> statement-breakpoint
DROP TYPE "public"."redline_confidence";--> statement-breakpoint
DROP TYPE "public"."redline_direction";--> statement-breakpoint
DROP TYPE "public"."redline_draft_status";--> statement-breakpoint
DROP TYPE "public"."redline_job_status";--> statement-breakpoint
DROP TYPE "public"."redline_pattern_type";--> statement-breakpoint
DROP TYPE "public"."redline_surface";