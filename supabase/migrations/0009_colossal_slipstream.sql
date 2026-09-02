CREATE TYPE "public"."redline_author" AS ENUM('agent', 'human');--> statement-breakpoint
CREATE TYPE "public"."redline_confidence" AS ENUM('unconfirmed', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."redline_direction" AS ENUM('avoid', 'prefer');--> statement-breakpoint
CREATE TYPE "public"."redline_draft_status" AS ENUM('open', 'finalized', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."redline_job_status" AS ENUM('pending', 'processing', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."redline_pattern_type" AS ENUM('literal', 'regex');--> statement-breakpoint
CREATE TYPE "public"."redline_surface" AS ENUM('manual', 'doc', 'email');--> statement-breakpoint
CREATE TABLE "redline_derivation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair_id" uuid NOT NULL,
	"status" "redline_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redline_derivation_jobs_pair_id_unique" UNIQUE("pair_id")
);
--> statement-breakpoint
CREATE TABLE "redline_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"context" text,
	"tags" text,
	"chat_uuid" text,
	"source" "redline_author" DEFAULT 'agent' NOT NULL,
	"status" "redline_draft_status" DEFAULT 'open' NOT NULL,
	"current_content" text NOT NULL,
	"pair_id" uuid,
	"surface" "redline_surface" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redline_lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair_id" uuid,
	"lesson" text NOT NULL,
	"tags" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redline_pairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid,
	"surface" "redline_surface" DEFAULT 'manual' NOT NULL,
	"context" text,
	"tags" text,
	"chat_uuid" text,
	"draft_content" text NOT NULL,
	"final_content" text NOT NULL,
	"diff_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redline_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid,
	"rule" text NOT NULL,
	"pattern" text NOT NULL,
	"pattern_type" "redline_pattern_type" DEFAULT 'literal' NOT NULL,
	"direction" "redline_direction" DEFAULT 'avoid' NOT NULL,
	"category" text DEFAULT 'style' NOT NULL,
	"before_text" text,
	"after_text" text,
	"confidence" "redline_confidence" DEFAULT 'unconfirmed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redline_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"content" text NOT NULL,
	"author" "redline_author" DEFAULT 'agent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "redline_derivation_jobs" ADD CONSTRAINT "redline_derivation_jobs_pair_id_redline_pairs_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."redline_pairs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redline_lessons" ADD CONSTRAINT "redline_lessons_pair_id_redline_pairs_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."redline_pairs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redline_patterns" ADD CONSTRAINT "redline_patterns_lesson_id_redline_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."redline_lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redline_revisions" ADD CONSTRAINT "redline_revisions_draft_id_redline_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."redline_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_redline_drafts_status" ON "redline_drafts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_redline_lessons_pair" ON "redline_lessons" USING btree ("pair_id");--> statement-breakpoint
CREATE INDEX "idx_redline_pairs_created" ON "redline_pairs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_redline_revisions_draft" ON "redline_revisions" USING btree ("draft_id");