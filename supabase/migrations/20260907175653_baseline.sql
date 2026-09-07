


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";








ALTER SCHEMA "public" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "public";






CREATE TYPE "public"."brain_entity_kind" AS ENUM (
    'company',
    'person',
    'project',
    'topic',
    'prospect'
);


ALTER TYPE "public"."brain_entity_kind" OWNER TO "postgres";


CREATE TYPE "public"."brain_fact_kind" AS ENUM (
    'event',
    'preference',
    'commitment',
    'belief',
    'fact',
    'idea',
    'lesson'
);


ALTER TYPE "public"."brain_fact_kind" OWNER TO "postgres";


CREATE TYPE "public"."brain_job_status" AS ENUM (
    'pending',
    'running',
    'done',
    'failed'
);


ALTER TYPE "public"."brain_job_status" OWNER TO "postgres";


CREATE TYPE "public"."brain_loop_detector" AS ENUM (
    'deterministic_thread',
    'llm_extract',
    'manual'
);


ALTER TYPE "public"."brain_loop_detector" OWNER TO "postgres";


CREATE TYPE "public"."brain_loop_status" AS ENUM (
    'open',
    'done',
    'dropped',
    'stale'
);


ALTER TYPE "public"."brain_loop_status" OWNER TO "postgres";


CREATE TYPE "public"."brain_loop_type" AS ENUM (
    'commitment_owed_by_me',
    'commitment_owed_to_me',
    'unanswered_inbound',
    'unanswered_outbound',
    'decision_pending'
);


ALTER TYPE "public"."brain_loop_type" OWNER TO "postgres";


CREATE TYPE "public"."brain_notability" AS ENUM (
    'high',
    'medium',
    'low'
);


ALTER TYPE "public"."brain_notability" OWNER TO "postgres";


CREATE TYPE "public"."brain_take_kind" AS ENUM (
    'fact',
    'take',
    'bet',
    'hypothesis'
);


ALTER TYPE "public"."brain_take_kind" OWNER TO "postgres";


CREATE TYPE "public"."brain_visibility" AS ENUM (
    'private',
    'world'
);


ALTER TYPE "public"."brain_visibility" OWNER TO "postgres";


CREATE TYPE "public"."deliverable_status" AS ENUM (
    'planned',
    'in_progress',
    'review',
    'completed',
    'blocked'
);


ALTER TYPE "public"."deliverable_status" OWNER TO "postgres";


CREATE TYPE "public"."doc_kind" AS ENUM (
    'post',
    'newsletter'
);


ALTER TYPE "public"."doc_kind" OWNER TO "postgres";


CREATE TYPE "public"."doc_status" AS ENUM (
    'draft',
    'final',
    'scheduled',
    'publishing',
    'published',
    'failed'
);


ALTER TYPE "public"."doc_status" OWNER TO "postgres";


CREATE TYPE "public"."document_type" AS ENUM (
    'link',
    'file',
    'transcript'
);


ALTER TYPE "public"."document_type" OWNER TO "postgres";


CREATE TYPE "public"."document_visibility" AS ENUM (
    'client',
    'internal',
    'draft'
);


ALTER TYPE "public"."document_visibility" OWNER TO "postgres";


CREATE TYPE "public"."engagement_type" AS ENUM (
    'retainer',
    'hourly',
    'project'
);


ALTER TYPE "public"."engagement_type" OWNER TO "postgres";


CREATE TYPE "public"."invoice_status" AS ENUM (
    'draft',
    'sent',
    'paid',
    'void'
);


ALTER TYPE "public"."invoice_status" OWNER TO "postgres";


CREATE TYPE "public"."project_status" AS ENUM (
    'active',
    'paused',
    'completed'
);


ALTER TYPE "public"."project_status" OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."api_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_id" "uuid",
    "label" "text" DEFAULT 'Default'::"text" NOT NULL,
    "key_hash" "text" NOT NULL,
    "key_prefix" "text" NOT NULL,
    "last_used_at" timestamp without time zone,
    "revoked_at" timestamp without time zone,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."api_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."brain_chunks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "page_id" "uuid" NOT NULL,
    "chunk_index" integer NOT NULL,
    "chunk_text" "text" NOT NULL,
    "token_count" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "embedding" "public"."vector"(1536),
    "embedded_at" timestamp with time zone,
    "embedded_text_hash" "text"
);


ALTER TABLE "public"."brain_chunks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."brain_facts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "entity_slug" "text" NOT NULL,
    "fact" "text" NOT NULL,
    "kind" "public"."brain_fact_kind" DEFAULT 'fact'::"public"."brain_fact_kind" NOT NULL,
    "visibility" "public"."brain_visibility" DEFAULT 'private'::"public"."brain_visibility" NOT NULL,
    "notability" "public"."brain_notability" DEFAULT 'medium'::"public"."brain_notability" NOT NULL,
    "context" "text",
    "surface" "text",
    "valid_from" timestamp with time zone DEFAULT "now"() NOT NULL,
    "valid_until" timestamp with time zone,
    "expired_at" timestamp with time zone,
    "superseded_by" "uuid",
    "consolidated_at" timestamp with time zone,
    "consolidated_into" "uuid",
    "source_table" "text" NOT NULL,
    "source_id" "uuid",
    "confidence" real DEFAULT 1 NOT NULL,
    "fact_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "embedding" "public"."vector"(1536),
    "embedded_at" timestamp with time zone,
    "genre" "text"
);


ALTER TABLE "public"."brain_facts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."brain_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phase" "text" NOT NULL,
    "scope" "text",
    "status" "public"."brain_job_status" DEFAULT 'pending'::"public"."brain_job_status" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."brain_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."brain_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "from_page_id" "uuid" NOT NULL,
    "to_page_id" "uuid" NOT NULL,
    "link_type" "text" DEFAULT ''::"text" NOT NULL,
    "context" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."brain_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."brain_open_loops" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dedup_key" "text" NOT NULL,
    "loop_type" "public"."brain_loop_type" NOT NULL,
    "company_id" "uuid",
    "counterparty_slug" "text",
    "counterparty_email" "text",
    "summary" "text" NOT NULL,
    "evidence" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "thread_id" "uuid",
    "page_slug" "text",
    "due_at" timestamp with time zone,
    "status" "public"."brain_loop_status" DEFAULT 'open'::"public"."brain_loop_status" NOT NULL,
    "detector" "public"."brain_loop_detector" DEFAULT 'deterministic_thread'::"public"."brain_loop_detector" NOT NULL,
    "confidence" real DEFAULT 1 NOT NULL,
    "opened_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_activity_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "closed_at" timestamp with time zone,
    "closed_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."brain_open_loops" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."brain_pages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "type" "text" DEFAULT 'entity'::"text" NOT NULL,
    "entity_kind" "public"."brain_entity_kind",
    "company_id" "uuid",
    "title" "text" NOT NULL,
    "compiled_truth" "text" DEFAULT ''::"text" NOT NULL,
    "timeline_text" "text" DEFAULT ''::"text" NOT NULL,
    "frontmatter" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "content_hash" "text",
    "emotional_weight" real DEFAULT 0 NOT NULL,
    "deleted_at" timestamp with time zone,
    "last_retrieved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."brain_pages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."brain_state" (
    "key" "text" NOT NULL,
    "value" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."brain_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."brain_takes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "page_id" "uuid" NOT NULL,
    "row_num" integer NOT NULL,
    "claim" "text" NOT NULL,
    "kind" "public"."brain_take_kind" DEFAULT 'take'::"public"."brain_take_kind" NOT NULL,
    "holder" "text" DEFAULT 'madcactus'::"text" NOT NULL,
    "weight" real DEFAULT 0.5 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "superseded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."brain_takes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."brain_timeline" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "page_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "source" "text" DEFAULT ''::"text" NOT NULL,
    "summary" "text" NOT NULL,
    "detail" "text" DEFAULT ''::"text" NOT NULL,
    "source_table" "text",
    "source_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."brain_timeline" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_company_members" (
    "member_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."client_company_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "password_hash" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."client_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."companies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "aliases" "text"
);


ALTER TABLE "public"."companies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deliverable_updates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "deliverable_id" "uuid" NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."deliverable_updates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deliverables" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text",
    "status" "public"."deliverable_status" DEFAULT 'planned'::"public"."deliverable_status" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."deliverables" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."docs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" DEFAULT 'Untitled'::"text" NOT NULL,
    "markdown" "text" DEFAULT ''::"text" NOT NULL,
    "loro_snapshot" "text" DEFAULT ''::"text" NOT NULL,
    "version" integer DEFAULT 0 NOT NULL,
    "chat_uuid" "text",
    "share_token" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "public"."doc_status" DEFAULT 'final'::"public"."doc_status" NOT NULL,
    "kind" "public"."doc_kind",
    "scheduled_for" timestamp with time zone,
    "published_at" timestamp with time zone,
    "publish_error" "text",
    "first_comment" "text",
    "genre" "text"
);


ALTER TABLE "public"."docs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid",
    "type" "public"."document_type" DEFAULT 'link'::"public"."document_type" NOT NULL,
    "title" "text" NOT NULL,
    "url" "text",
    "file_name" "text",
    "file_size" bigint,
    "mime_type" "text",
    "description" "text",
    "content" "text",
    "visibility" "public"."document_visibility" DEFAULT 'client'::"public"."document_visibility" NOT NULL,
    "audio_path" "text",
    "audio_file_name" "text",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "transcript_json" "text"
);


ALTER TABLE "public"."documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "refresh_token" "text" NOT NULL,
    "scopes" "text",
    "sync_history_id" "text",
    "last_sync_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."email_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "thread_id" "uuid" NOT NULL,
    "gmail_id" "text" NOT NULL,
    "from_name" "text",
    "from_email" "text",
    "to_emails" "text",
    "body_text" "text" DEFAULT ''::"text" NOT NULL,
    "date" timestamp with time zone NOT NULL,
    "is_sent" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."email_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_outbox" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "thread_id" "uuid",
    "to_email" "text" NOT NULL,
    "subject" "text" NOT NULL,
    "body" "text" NOT NULL,
    "chat_uuid" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "gmail_message_id" "text",
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "loro_snapshot" "text" DEFAULT ''::"text" NOT NULL,
    "version" integer DEFAULT 0 NOT NULL,
    "send_at" timestamp with time zone
);


ALTER TABLE "public"."email_outbox" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_threads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "gmail_thread_id" "text" NOT NULL,
    "subject" "text" DEFAULT '(no subject)'::"text" NOT NULL,
    "snippet" "text",
    "from_name" "text",
    "from_email" "text",
    "unread" boolean DEFAULT false NOT NULL,
    "archived" boolean DEFAULT false NOT NULL,
    "last_message_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."email_threads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "number" "text" NOT NULL,
    "amount" double precision NOT NULL,
    "status" "public"."invoice_status" DEFAULT 'draft'::"public"."invoice_status" NOT NULL,
    "issue_date" timestamp without time zone DEFAULT "now"() NOT NULL,
    "due_date" timestamp without time zone,
    "payment_url" "text",
    "file_name" "text",
    "file_size" bigint,
    "storage_path" "text",
    "notes" "text",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "engagement_type" "public"."engagement_type" DEFAULT 'hourly'::"public"."engagement_type" NOT NULL,
    "hourly_rate" double precision DEFAULT 0 NOT NULL,
    "fixed_price" double precision,
    "monthly_cap_hours" double precision,
    "status" "public"."project_status" DEFAULT 'active'::"public"."project_status" NOT NULL,
    "notes" "text",
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."time_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "entry_date" timestamp without time zone DEFAULT "now"() NOT NULL,
    "hours" double precision NOT NULL,
    "description" "text" NOT NULL,
    "billable" boolean DEFAULT true NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."time_entries" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."monthly_hours_by_project" AS
 SELECT "projects"."id",
    "projects"."name",
    "date_trunc"('month'::"text", "time_entries"."entry_date") AS "month",
    "sum"("time_entries"."hours") AS "hours"
   FROM ("public"."projects"
     JOIN "public"."time_entries" ON (("time_entries"."project_id" = "projects"."id")))
  GROUP BY "projects"."id", "projects"."name", ("date_trunc"('month'::"text", "time_entries"."entry_date"));


ALTER VIEW "public"."monthly_hours_by_project" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."outreach_prospects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company" "text" NOT NULL,
    "contact_name" "text",
    "email" "text",
    "stage" "text" DEFAULT 'proposed'::"text" NOT NULL,
    "next_action_at" timestamp with time zone,
    "next_action_note" "text",
    "brain_url" "text",
    "video_url" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "video_view_count" integer DEFAULT 0 NOT NULL,
    "video_first_viewed_at" timestamp with time zone,
    "video_last_viewed_at" timestamp with time zone,
    "video_watch_seconds" integer DEFAULT 0 NOT NULL,
    "video_max_position" integer DEFAULT 0 NOT NULL,
    "video_duration_seconds" integer,
    "video_completed" boolean DEFAULT false NOT NULL,
    "brain_activity_key" "text",
    "video_description" "text",
    CONSTRAINT "outreach_stage_check" CHECK (("stage" = ANY (ARRAY['proposed'::"text", 'sent'::"text", 'watching'::"text", 'replied'::"text", 'meeting'::"text", 'won'::"text", 'shutdown'::"text"])))
);


ALTER TABLE "public"."outreach_prospects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."slack_channels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slack_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "purpose" "text" DEFAULT ''::"text" NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "last_sync_at" timestamp with time zone
);


ALTER TABLE "public"."slack_channels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."slack_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "channel_id" "uuid" NOT NULL,
    "ts" "text" NOT NULL,
    "thread_ts" "text",
    "user_id" "text",
    "user_name" "text" DEFAULT ''::"text" NOT NULL,
    "text" "text" DEFAULT ''::"text" NOT NULL,
    "is_bot" boolean DEFAULT false NOT NULL,
    "message_at" timestamp with time zone NOT NULL,
    "synced_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."slack_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."slack_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slack_id" "text" NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "real_name" "text" DEFAULT ''::"text" NOT NULL,
    "email" "text",
    "is_bot" boolean DEFAULT false NOT NULL,
    "deleted" boolean DEFAULT false NOT NULL,
    "synced_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."slack_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."social_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" NOT NULL,
    "member_urn" "text",
    "access_token" "text" NOT NULL,
    "refresh_token" "text",
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."social_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."text_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "entity" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "version" integer NOT NULL,
    "author" "text" DEFAULT 'human'::"text" NOT NULL,
    "content" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."text_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."timer" (
    "id" integer NOT NULL,
    "project_id" "uuid" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "started_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "timer_singleton" CHECK (("id" = 1))
);


ALTER TABLE "public"."timer" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."voice_lint_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pattern_id" "uuid" NOT NULL,
    "outbox_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."voice_lint_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."voice_patterns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rule" "text" NOT NULL,
    "pattern" "text" NOT NULL,
    "pattern_type" "text" DEFAULT 'literal'::"text" NOT NULL,
    "direction" "text" DEFAULT 'avoid'::"text" NOT NULL,
    "category" "text" DEFAULT 'style'::"text" NOT NULL,
    "before_text" "text",
    "after_text" "text",
    "lesson_text" "text",
    "confidence" real DEFAULT 1 NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "override_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "surface" "text",
    "genre" "text"
);


ALTER TABLE "public"."voice_patterns" OWNER TO "postgres";


ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_key_hash_unique" UNIQUE ("key_hash");



ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."brain_chunks"
    ADD CONSTRAINT "brain_chunks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."brain_facts"
    ADD CONSTRAINT "brain_facts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."brain_jobs"
    ADD CONSTRAINT "brain_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."brain_links"
    ADD CONSTRAINT "brain_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."brain_open_loops"
    ADD CONSTRAINT "brain_open_loops_dedup_key_unique" UNIQUE ("dedup_key");



ALTER TABLE ONLY "public"."brain_open_loops"
    ADD CONSTRAINT "brain_open_loops_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."brain_pages"
    ADD CONSTRAINT "brain_pages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."brain_pages"
    ADD CONSTRAINT "brain_pages_slug_unique" UNIQUE ("slug");



ALTER TABLE ONLY "public"."brain_state"
    ADD CONSTRAINT "brain_state_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."brain_takes"
    ADD CONSTRAINT "brain_takes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."brain_timeline"
    ADD CONSTRAINT "brain_timeline_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_company_members"
    ADD CONSTRAINT "client_company_members_member_id_company_id_pk" PRIMARY KEY ("member_id", "company_id");



ALTER TABLE ONLY "public"."client_members"
    ADD CONSTRAINT "client_members_email_unique" UNIQUE ("email");



ALTER TABLE ONLY "public"."client_members"
    ADD CONSTRAINT "client_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deliverable_updates"
    ADD CONSTRAINT "deliverable_updates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deliverables"
    ADD CONSTRAINT "deliverables_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."docs"
    ADD CONSTRAINT "docs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."docs"
    ADD CONSTRAINT "docs_share_token_unique" UNIQUE ("share_token");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_accounts"
    ADD CONSTRAINT "email_accounts_email_unique" UNIQUE ("email");



ALTER TABLE ONLY "public"."email_accounts"
    ADD CONSTRAINT "email_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_messages"
    ADD CONSTRAINT "email_messages_gmail_id_unique" UNIQUE ("gmail_id");



ALTER TABLE ONLY "public"."email_messages"
    ADD CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_outbox"
    ADD CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_threads"
    ADD CONSTRAINT "email_threads_gmail_thread_id_unique" UNIQUE ("gmail_thread_id");



ALTER TABLE ONLY "public"."email_threads"
    ADD CONSTRAINT "email_threads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."outreach_prospects"
    ADD CONSTRAINT "outreach_prospects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."slack_channels"
    ADD CONSTRAINT "slack_channels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."slack_channels"
    ADD CONSTRAINT "slack_channels_slack_id_unique" UNIQUE ("slack_id");



ALTER TABLE ONLY "public"."slack_messages"
    ADD CONSTRAINT "slack_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."slack_users"
    ADD CONSTRAINT "slack_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."slack_users"
    ADD CONSTRAINT "slack_users_slack_id_unique" UNIQUE ("slack_id");



ALTER TABLE ONLY "public"."social_accounts"
    ADD CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."social_accounts"
    ADD CONSTRAINT "social_accounts_provider_unique" UNIQUE ("provider");



ALTER TABLE ONLY "public"."text_versions"
    ADD CONSTRAINT "text_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."time_entries"
    ADD CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."timer"
    ADD CONSTRAINT "timer_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."voice_lint_overrides"
    ADD CONSTRAINT "voice_lint_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."voice_patterns"
    ADD CONSTRAINT "voice_patterns_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "brain_facts_entity_hash_uq" ON "public"."brain_facts" USING "btree" ("entity_slug", "fact_hash");



CREATE UNIQUE INDEX "brain_links_from_to_type_uq" ON "public"."brain_links" USING "btree" ("from_page_id", "to_page_id", "link_type");



CREATE UNIQUE INDEX "brain_takes_page_row_uq" ON "public"."brain_takes" USING "btree" ("page_id", "row_num");



CREATE INDEX "idx_api_keys_hash" ON "public"."api_keys" USING "btree" ("key_hash");



CREATE INDEX "idx_api_keys_member" ON "public"."api_keys" USING "btree" ("member_id");



CREATE INDEX "idx_brain_chunks_embedding" ON "public"."brain_chunks" USING "hnsw" ("embedding" "public"."vector_cosine_ops") WHERE ("embedding" IS NOT NULL);



CREATE INDEX "idx_brain_chunks_fts" ON "public"."brain_chunks" USING "gin" ("to_tsvector"('"english"'::"regconfig", "chunk_text"));



CREATE INDEX "idx_brain_chunks_page" ON "public"."brain_chunks" USING "btree" ("page_id");



CREATE INDEX "idx_brain_facts_embedding" ON "public"."brain_facts" USING "hnsw" ("embedding" "public"."vector_cosine_ops") WHERE ("embedding" IS NOT NULL);



CREATE INDEX "idx_brain_facts_entity" ON "public"."brain_facts" USING "btree" ("entity_slug");



CREATE INDEX "idx_brain_facts_entity_live" ON "public"."brain_facts" USING "btree" ("entity_slug") WHERE ("expired_at" IS NULL);



CREATE INDEX "idx_brain_jobs_phase_status" ON "public"."brain_jobs" USING "btree" ("phase", "status");



CREATE INDEX "idx_brain_pages_company" ON "public"."brain_pages" USING "btree" ("company_id");



CREATE INDEX "idx_brain_pages_fts" ON "public"."brain_pages" USING "gin" ("to_tsvector"('"english"'::"regconfig", (("title" || ' '::"text") || "compiled_truth")));



CREATE INDEX "idx_brain_pages_trgm" ON "public"."brain_pages" USING "gin" ("title" "public"."gin_trgm_ops");



CREATE INDEX "idx_brain_pages_type" ON "public"."brain_pages" USING "btree" ("type");



CREATE INDEX "idx_brain_timeline_page" ON "public"."brain_timeline" USING "btree" ("page_id", "date");



CREATE INDEX "idx_deliverable_updates_deliverable" ON "public"."deliverable_updates" USING "btree" ("deliverable_id");



CREATE INDEX "idx_deliverables_project" ON "public"."deliverables" USING "btree" ("project_id");



CREATE INDEX "idx_docs_scheduled" ON "public"."docs" USING "btree" ("scheduled_for");



CREATE INDEX "idx_documents_project" ON "public"."documents" USING "btree" ("project_id");



CREATE INDEX "idx_email_messages_thread" ON "public"."email_messages" USING "btree" ("thread_id");



CREATE INDEX "idx_email_outbox_status" ON "public"."email_outbox" USING "btree" ("status");



CREATE INDEX "idx_email_threads_inbox" ON "public"."email_threads" USING "btree" ("account_id", "archived", "last_message_at");



CREATE INDEX "idx_invoices_project" ON "public"."invoices" USING "btree" ("project_id");



CREATE INDEX "idx_projects_company" ON "public"."projects" USING "btree" ("company_id");



CREATE INDEX "idx_slack_messages_date" ON "public"."slack_messages" USING "btree" ("message_at");



CREATE INDEX "idx_time_entries_date" ON "public"."time_entries" USING "btree" ("entry_date");



CREATE INDEX "idx_time_entries_project" ON "public"."time_entries" USING "btree" ("project_id");



CREATE UNIQUE INDEX "slack_messages_channel_ts_uq" ON "public"."slack_messages" USING "btree" ("channel_id", "ts");



CREATE UNIQUE INDEX "text_versions_entity_ver_idx" ON "public"."text_versions" USING "btree" ("entity", "entity_id", "version");



CREATE UNIQUE INDEX "voice_patterns_rule_pattern_uq" ON "public"."voice_patterns" USING "btree" ("rule", "pattern");



ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_member_id_client_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."client_members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."brain_chunks"
    ADD CONSTRAINT "brain_chunks_page_id_brain_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."brain_pages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."brain_links"
    ADD CONSTRAINT "brain_links_from_page_id_brain_pages_id_fk" FOREIGN KEY ("from_page_id") REFERENCES "public"."brain_pages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."brain_links"
    ADD CONSTRAINT "brain_links_to_page_id_brain_pages_id_fk" FOREIGN KEY ("to_page_id") REFERENCES "public"."brain_pages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."brain_open_loops"
    ADD CONSTRAINT "brain_open_loops_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."brain_open_loops"
    ADD CONSTRAINT "brain_open_loops_thread_id_email_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_threads"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."brain_pages"
    ADD CONSTRAINT "brain_pages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."brain_takes"
    ADD CONSTRAINT "brain_takes_page_id_brain_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."brain_pages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."brain_timeline"
    ADD CONSTRAINT "brain_timeline_page_id_brain_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."brain_pages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_company_members"
    ADD CONSTRAINT "client_company_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_company_members"
    ADD CONSTRAINT "client_company_members_member_id_client_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."client_members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deliverable_updates"
    ADD CONSTRAINT "deliverable_updates_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deliverables"
    ADD CONSTRAINT "deliverables_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_messages"
    ADD CONSTRAINT "email_messages_thread_id_email_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_threads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_threads"
    ADD CONSTRAINT "email_threads_account_id_email_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."email_accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."slack_messages"
    ADD CONSTRAINT "slack_messages_channel_id_slack_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."slack_channels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."time_entries"
    ADD CONSTRAINT "time_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timer"
    ADD CONSTRAINT "timer_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."voice_lint_overrides"
    ADD CONSTRAINT "voice_lint_overrides_pattern_id_fkey" FOREIGN KEY ("pattern_id") REFERENCES "public"."voice_patterns"("id") ON DELETE CASCADE;





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





REVOKE USAGE ON SCHEMA "public" FROM PUBLIC;




































































































































































































































-- Squashed storage setup (from old 0002/0003): portal-docs bucket + size limit.
-- Guarded so this replays on any environment; storage schema only exists on Supabase.
insert into storage.buckets (id, name, public)
values ('_portal-docs', '_portal-docs', false)
on conflict (id) do nothing;
update storage.buckets set file_size_limit = 157286400 -- 150 MiB
 where id = '_portal-docs';
