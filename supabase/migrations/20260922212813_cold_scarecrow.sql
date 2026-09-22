ALTER TABLE "short_link_clicks" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "short_link_clicks" CASCADE;--> statement-breakpoint
ALTER TABLE "resend_events" RENAME TO "newsletter_events";--> statement-breakpoint
ALTER TABLE "newsletter_events" DROP CONSTRAINT "resend_events_event_id_unique";--> statement-breakpoint
ALTER TABLE "newsletter_events" DROP CONSTRAINT "resend_events_doc_id_docs_id_fk";
--> statement-breakpoint
ALTER TABLE "newsletter_events" ADD CONSTRAINT "newsletter_events_doc_id_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."docs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_events" ADD CONSTRAINT "newsletter_events_event_id_unique" UNIQUE("event_id");