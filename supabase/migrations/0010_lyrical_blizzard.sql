CREATE TABLE "docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text DEFAULT 'Untitled' NOT NULL,
	"markdown" text DEFAULT '' NOT NULL,
	"loro_snapshot" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"last_agent_content" text,
	"chat_uuid" text,
	"share_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "docs_share_token_unique" UNIQUE("share_token")
);
