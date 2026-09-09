-- IF NOT EXISTS reconciliation: short_links may already exist on prod from the
-- since-deleted hand-written 0032_short_links migration. Harmless on fresh replays.
CREATE TABLE IF NOT EXISTS "short_links" (
	"slug" text PRIMARY KEY NOT NULL,
	"target" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_lesson_reviews" (
	"chat_uuid" text PRIMARY KEY NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
