-- Outreach brain activity keys move from the BRAIN_ACTIVITY_KEYS env secret
-- to a per-prospect column (editable in the dashboard + via brain MCP).
ALTER TABLE "outreach_prospects" ADD COLUMN IF NOT EXISTS "brain_activity_key" text;
