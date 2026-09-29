CREATE TABLE "funnel_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"company_name" text NOT NULL,
	"city" text,
	"state" text,
	"source_url" text,
	"source_kind" text,
	"raw_data" jsonb,
	"prospect_id" uuid,
	"promoted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funnel_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funnel_id" uuid NOT NULL,
	"source" text DEFAULT 'paste' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "funnel_run_status_check" CHECK ("funnel_runs"."status" in ('open', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "funnel_stage_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"verdict" text NOT NULL,
	"evidence_url" text,
	"note" text,
	"method" text DEFAULT 'human' NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funnel_stage_verdict_check" CHECK ("funnel_stage_results"."verdict" in ('pass', 'fail')),
	CONSTRAINT "funnel_stage_method_check" CHECK ("funnel_stage_results"."method" in ('source', 'api', 'agent', 'human'))
);
--> statement-breakpoint
CREATE TABLE "funnels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"stages" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funnels_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "outreach_prospects" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "outreach_prospects" ADD COLUMN "revenue_band" text;--> statement-breakpoint
ALTER TABLE "outreach_prospects" ADD COLUMN "tech_team" text;--> statement-breakpoint
ALTER TABLE "outreach_prospects" ADD COLUMN "icp_approved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_prospects" ADD COLUMN "source_note" text;--> statement-breakpoint
ALTER TABLE "funnel_items" ADD CONSTRAINT "funnel_items_run_id_funnel_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."funnel_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_items" ADD CONSTRAINT "funnel_items_prospect_id_outreach_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."outreach_prospects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_runs" ADD CONSTRAINT "funnel_runs_funnel_id_funnels_id_fk" FOREIGN KEY ("funnel_id") REFERENCES "public"."funnels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_stage_results" ADD CONSTRAINT "funnel_stage_results_item_id_funnel_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."funnel_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_items_run_company_uq" ON "funnel_items" USING btree ("run_id","company_name");--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_stage_results_item_stage_uq" ON "funnel_stage_results" USING btree ("item_id","stage");