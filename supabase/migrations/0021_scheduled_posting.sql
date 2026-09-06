CREATE TYPE "public"."doc_kind" AS ENUM('post', 'newsletter');--> statement-breakpoint
ALTER TYPE "public"."doc_status" ADD VALUE 'scheduled';--> statement-breakpoint
ALTER TYPE "public"."doc_status" ADD VALUE 'publishing';--> statement-breakpoint
ALTER TYPE "public"."doc_status" ADD VALUE 'published';--> statement-breakpoint
ALTER TYPE "public"."doc_status" ADD VALUE 'failed';--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"member_urn" text,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_accounts_provider_unique" UNIQUE("provider")
);
--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "kind" "doc_kind";--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "scheduled_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "publish_error" text;--> statement-breakpoint
-- ponytail: no partial-index predicate — WHERE status='scheduled' uses the enum value
-- added above in this same transaction → PG12+ "unsafe use of new value" → supabase
-- auto-apply rolls the whole migration back. Re-add the WHERE once this is its own migration.
CREATE INDEX IF NOT EXISTS "idx_docs_scheduled" ON "docs" ("scheduled_for");
