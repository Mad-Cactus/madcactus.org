CREATE TYPE "public"."publish_channel" AS ENUM('email+web', 'web');--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "publish_channel" "publish_channel" DEFAULT 'email+web' NOT NULL;