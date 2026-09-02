CREATE TABLE "outreach_prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company" text NOT NULL,
	"contact_name" text,
	"email" text,
	"stage" text DEFAULT 'sent' NOT NULL,
	"next_action_at" timestamp with time zone,
	"next_action_note" text,
	"brain_url" text,
	"video_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outreach_stage_check" CHECK ("outreach_prospects"."stage" in ('sent', 'watching', 'replied', 'meeting', 'won', 'shutdown'))
);

-- Seed: MO Strategies outreach (next follow-up due in 5 days)
INSERT INTO "outreach_prospects" ("company", "contact_name", "stage", "next_action_at", "brain_url")
VALUES ('MO Strategies', 'Marty Obst', 'sent', now() + interval '5 days', 'https://mo-strategies-brain.fly.dev');
