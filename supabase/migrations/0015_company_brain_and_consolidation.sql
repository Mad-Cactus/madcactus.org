CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."brain_entity_kind" AS ENUM('company', 'person', 'project', 'topic', 'prospect');--> statement-breakpoint
CREATE TYPE "public"."brain_fact_kind" AS ENUM('event', 'preference', 'commitment', 'belief', 'fact', 'idea', 'lesson');--> statement-breakpoint
CREATE TYPE "public"."brain_job_status" AS ENUM('pending', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."brain_loop_detector" AS ENUM('deterministic_thread', 'llm_extract', 'manual');--> statement-breakpoint
CREATE TYPE "public"."brain_loop_status" AS ENUM('open', 'done', 'dropped', 'stale');--> statement-breakpoint
CREATE TYPE "public"."brain_loop_type" AS ENUM('commitment_owed_by_me', 'commitment_owed_to_me', 'unanswered_inbound', 'unanswered_outbound', 'decision_pending');--> statement-breakpoint
CREATE TYPE "public"."brain_notability" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."brain_take_kind" AS ENUM('fact', 'take', 'bet', 'hypothesis');--> statement-breakpoint
CREATE TYPE "public"."brain_visibility" AS ENUM('private', 'world');--> statement-breakpoint
CREATE TYPE "public"."doc_status" AS ENUM('draft', 'final');--> statement-breakpoint
CREATE TABLE "brain_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"chunk_text" text NOT NULL,
	"token_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brain_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_slug" text NOT NULL,
	"fact" text NOT NULL,
	"kind" "brain_fact_kind" DEFAULT 'fact' NOT NULL,
	"visibility" "brain_visibility" DEFAULT 'private' NOT NULL,
	"notability" "brain_notability" DEFAULT 'medium' NOT NULL,
	"context" text,
	"surface" text,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"superseded_by" uuid,
	"consolidated_at" timestamp with time zone,
	"consolidated_into" uuid,
	"source_table" text NOT NULL,
	"source_id" uuid,
	"confidence" real DEFAULT 1 NOT NULL,
	"fact_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brain_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phase" text NOT NULL,
	"scope" text,
	"status" "brain_job_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brain_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_page_id" uuid NOT NULL,
	"to_page_id" uuid NOT NULL,
	"link_type" text DEFAULT '' NOT NULL,
	"context" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brain_open_loops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedup_key" text NOT NULL,
	"loop_type" "brain_loop_type" NOT NULL,
	"company_id" uuid,
	"counterparty_slug" text,
	"counterparty_email" text,
	"summary" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"thread_id" uuid,
	"page_slug" text,
	"due_at" timestamp with time zone,
	"status" "brain_loop_status" DEFAULT 'open' NOT NULL,
	"detector" "brain_loop_detector" DEFAULT 'deterministic_thread' NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brain_open_loops_dedup_key_unique" UNIQUE("dedup_key")
);
--> statement-breakpoint
CREATE TABLE "brain_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"type" text DEFAULT 'entity' NOT NULL,
	"entity_kind" "brain_entity_kind",
	"company_id" uuid,
	"title" text NOT NULL,
	"compiled_truth" text DEFAULT '' NOT NULL,
	"timeline_text" text DEFAULT '' NOT NULL,
	"frontmatter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text,
	"emotional_weight" real DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"last_retrieved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brain_pages_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "brain_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brain_takes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"row_num" integer NOT NULL,
	"claim" text NOT NULL,
	"kind" "brain_take_kind" DEFAULT 'take' NOT NULL,
	"holder" text DEFAULT 'madcactus' NOT NULL,
	"weight" real DEFAULT 0.5 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"superseded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brain_timeline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"date" date NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"summary" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"source_table" text,
	"source_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
-- ── Data migration: preserve the voice-learning corpus as a doc ──
-- The redline tables hold derived lessons + lint patterns from real
-- agent-draft → human-edit diffs. They move into a "Voice lessons" doc so
-- the brain's distillation keeps consuming them after the tables die.
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
ALTER TABLE "email_outbox" ADD COLUMN "loro_snapshot" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "brain_chunks" ADD CONSTRAINT "brain_chunks_page_id_brain_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."brain_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_links" ADD CONSTRAINT "brain_links_from_page_id_brain_pages_id_fk" FOREIGN KEY ("from_page_id") REFERENCES "public"."brain_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_links" ADD CONSTRAINT "brain_links_to_page_id_brain_pages_id_fk" FOREIGN KEY ("to_page_id") REFERENCES "public"."brain_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_open_loops" ADD CONSTRAINT "brain_open_loops_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_open_loops" ADD CONSTRAINT "brain_open_loops_thread_id_email_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_pages" ADD CONSTRAINT "brain_pages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_takes" ADD CONSTRAINT "brain_takes_page_id_brain_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."brain_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_timeline" ADD CONSTRAINT "brain_timeline_page_id_brain_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."brain_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_brain_chunks_page" ON "brain_chunks" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "idx_brain_facts_entity" ON "brain_facts" USING btree ("entity_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "brain_facts_entity_hash_uq" ON "brain_facts" USING btree ("entity_slug","fact_hash");--> statement-breakpoint
CREATE INDEX "idx_brain_jobs_phase_status" ON "brain_jobs" USING btree ("phase","status");--> statement-breakpoint
CREATE UNIQUE INDEX "brain_links_from_to_type_uq" ON "brain_links" USING btree ("from_page_id","to_page_id","link_type");--> statement-breakpoint
CREATE INDEX "idx_brain_pages_company" ON "brain_pages" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_brain_pages_type" ON "brain_pages" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "brain_takes_page_row_uq" ON "brain_takes" USING btree ("page_id","row_num");--> statement-breakpoint
CREATE INDEX "idx_brain_timeline_page" ON "brain_timeline" USING btree ("page_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "text_versions_entity_ver_idx" ON "text_versions" USING btree ("entity","entity_id","version");--> statement-breakpoint
ALTER TABLE "docs" DROP COLUMN "last_agent_content";--> statement-breakpoint
ALTER TABLE "email_outbox" DROP COLUMN "draft_id";--> statement-breakpoint
ALTER TABLE "email_outbox" DROP COLUMN "pair_id";--> statement-breakpoint
DROP TABLE "redline_derivation_jobs" CASCADE;--> statement-breakpoint
DROP TABLE "redline_drafts" CASCADE;--> statement-breakpoint
DROP TABLE "redline_lessons" CASCADE;--> statement-breakpoint
DROP TABLE "redline_pairs" CASCADE;--> statement-breakpoint
DROP TABLE "redline_patterns" CASCADE;--> statement-breakpoint
DROP TABLE "redline_revisions" CASCADE;--> statement-breakpoint
DROP TYPE "public"."redline_author";--> statement-breakpoint
DROP TYPE "public"."redline_confidence";--> statement-breakpoint
DROP TYPE "public"."redline_direction";--> statement-breakpoint
DROP TYPE "public"."redline_draft_status";--> statement-breakpoint
DROP TYPE "public"."redline_job_status";--> statement-breakpoint
DROP TYPE "public"."redline_pattern_type";--> statement-breakpoint
DROP TYPE "public"."redline_surface";CREATE INDEX IF NOT EXISTS idx_brain_pages_fts ON brain_pages USING GIN (to_tsvector('english', title || ' ' || compiled_truth));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_brain_pages_trgm ON brain_pages USING GIN (title gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_brain_chunks_fts ON brain_chunks USING GIN (to_tsvector('english', chunk_text));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_brain_facts_entity_live ON brain_facts (entity_slug) WHERE expired_at IS NULL;
