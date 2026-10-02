-- IF NOT EXISTS reconciliation: entity_links already exists on prod (applied
-- via db:push, before this migration was journaled). Harmless on fresh replays.
CREATE TABLE IF NOT EXISTS "entity_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_kind" text NOT NULL,
	"from_id" text NOT NULL,
	"to_kind" text NOT NULL,
	"to_id" text NOT NULL,
	"link_type" text DEFAULT 'mentions' NOT NULL,
	"context" text,
	"created_by" text DEFAULT 'human' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entity_links_uq" ON "entity_links" USING btree ("from_kind","from_id","to_kind","to_id","link_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_entity_links_from" ON "entity_links" USING btree ("from_kind","from_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_entity_links_to" ON "entity_links" USING btree ("to_kind","to_id");