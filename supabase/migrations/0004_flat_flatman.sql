ALTER TYPE "public"."document_visibility" ADD VALUE 'draft';--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "transcript_json" text;