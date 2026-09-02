CREATE TABLE "email_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"refresh_token" text NOT NULL,
	"scopes" text,
	"sync_history_id" text,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"gmail_id" text NOT NULL,
	"from_name" text,
	"from_email" text,
	"to_emails" text,
	"body_text" text DEFAULT '' NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"is_sent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_messages_gmail_id_unique" UNIQUE("gmail_id")
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid,
	"thread_id" uuid,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"chat_uuid" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"gmail_message_id" text,
	"pair_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"gmail_thread_id" text NOT NULL,
	"subject" text DEFAULT '(no subject)' NOT NULL,
	"snippet" text,
	"from_name" text,
	"from_email" text,
	"unread" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"last_message_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_threads_gmail_thread_id_unique" UNIQUE("gmail_thread_id")
);
--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_thread_id_email_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_account_id_email_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."email_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_email_messages_thread" ON "email_messages" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "idx_email_outbox_status" ON "email_outbox" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_email_threads_inbox" ON "email_threads" USING btree ("account_id","archived","last_message_at");