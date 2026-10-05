CREATE TABLE "funnel_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"funnel_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"discovery_source" text,
	"discovery_interval_days" integer DEFAULT 7 NOT NULL,
	"enrich_per_day" integer DEFAULT 50 NOT NULL,
	"tech_per_day" integer DEFAULT 15 NOT NULL,
	"last_discovery_at" timestamp with time zone,
	"last_enrich_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funnel_schedules_funnel_id_unique" UNIQUE("funnel_id"),
	CONSTRAINT "funnel_schedule_source_check" CHECK ("funnel_schedules"."discovery_source" is null or "funnel_schedules"."discovery_source" = 'fmcsa')
);
--> statement-breakpoint
ALTER TABLE "funnel_schedules" ADD CONSTRAINT "funnel_schedules_funnel_id_funnels_id_fk" FOREIGN KEY ("funnel_id") REFERENCES "public"."funnels"("id") ON DELETE cascade ON UPDATE no action;