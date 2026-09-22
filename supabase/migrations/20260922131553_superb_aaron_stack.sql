CREATE TABLE "short_link_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"doc_id" uuid,
	"recipient" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "short_link_clicks" ADD CONSTRAINT "short_link_clicks_slug_short_links_slug_fk" FOREIGN KEY ("slug") REFERENCES "public"."short_links"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "short_link_clicks" ADD CONSTRAINT "short_link_clicks_doc_id_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."docs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_short_link_clicks_person" ON "short_link_clicks" USING btree ("recipient","created_at");--> statement-breakpoint
CREATE INDEX "idx_short_link_clicks_slug" ON "short_link_clicks" USING btree ("slug","created_at");