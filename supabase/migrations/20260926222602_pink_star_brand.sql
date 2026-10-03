ALTER TABLE "campaigns" ADD COLUMN "templates" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "campaign_company_id" uuid;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "campaign_step" integer;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_campaign_company_id_campaign_companies_id_fk" FOREIGN KEY ("campaign_company_id") REFERENCES "public"."campaign_companies"("id") ON DELETE set null ON UPDATE no action;