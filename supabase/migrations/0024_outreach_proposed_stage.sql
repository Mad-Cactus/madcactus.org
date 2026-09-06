-- proposed = video recorded + brain wired, send not out yet
ALTER TABLE "outreach_prospects" DROP CONSTRAINT "outreach_stage_check";
ALTER TABLE "outreach_prospects" ADD CONSTRAINT "outreach_stage_check"
	CHECK ("outreach_prospects"."stage" in ('proposed', 'sent', 'watching', 'replied', 'meeting', 'won', 'shutdown'));
ALTER TABLE "outreach_prospects" ALTER COLUMN "stage" SET DEFAULT 'proposed';
