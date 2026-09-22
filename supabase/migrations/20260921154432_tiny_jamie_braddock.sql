CREATE TYPE "public"."brain_request_status" AS ENUM('new', 'building', 'delivered', 'declined');--> statement-breakpoint
CREATE TABLE "brain_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"company" text NOT NULL,
	"contact_email" text NOT NULL,
	"job_title" text,
	"headcount" text,
	"status" "brain_request_status" DEFAULT 'new' NOT NULL,
	"source_doc_id" uuid,
	"prospect_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resend_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"doc_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resend_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "outreach_prospects" DROP CONSTRAINT "outreach_stage_check";--> statement-breakpoint
ALTER TABLE "brain_facts" ADD COLUMN "topic" text;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "email_appendix" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "web_appendix" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "resend_broadcast_id" text;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "opens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "clicks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_prospects" ADD COLUMN "region" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_prospects" ADD COLUMN "revenue_band" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_prospects" ADD COLUMN "tech_team" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_prospects" ADD COLUMN "ai_interest" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_prospects" ADD COLUMN "icp_approved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_prospects" ADD COLUMN "source_note" text;--> statement-breakpoint
ALTER TABLE "outreach_prospects" ADD COLUMN "invited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brain_requests" ADD CONSTRAINT "brain_requests_source_doc_id_docs_id_fk" FOREIGN KEY ("source_doc_id") REFERENCES "public"."docs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_requests" ADD CONSTRAINT "brain_requests_prospect_id_outreach_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."outreach_prospects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resend_events" ADD CONSTRAINT "resend_events_doc_id_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."docs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_brain_requests_status" ON "brain_requests" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "outreach_prospects" ADD CONSTRAINT "outreach_stage_check" CHECK ("outreach_prospects"."stage" in ('candidate', 'proposed', 'sent', 'watching', 'replied', 'meeting', 'won', 'shutdown'));