-- Mad Cactus seed — a full fake corpus so a fresh clone is immediately
-- explorable: CRM, engagements, email, docs with agent/human version pairs,
-- meeting transcripts, slack chatter, outreach pipeline.
--
-- Idempotent (guarded inserts). Zero API keys required — every integration
-- degrades gracefully; add real keys later to light up LLM/Gmail/Slack.
--
-- The brain_* tables are intentionally empty: run a brain cycle (admin page
-- → "Run cycle") and watch them fill from this corpus.

-- ── Companies ──────────────────────────────────────────────────────
insert into companies (name, aliases)
select 'CDL', '["Custom Data Link", "CDL Logistics"]'
where not exists (select 1 from companies where name = 'CDL');
insert into companies (name, aliases)
select 'Koola Logistics', '["Koola"]'
where not exists (select 1 from companies where name = 'Koola Logistics');
insert into companies (name)
select 'Mad Cactus'
where not exists (select 1 from companies where name = 'Mad Cactus');

-- ── Client members (portal people — email maps threads → companies) ──
insert into client_members (name, email)
select 'Jane Doe', 'jane@cdl.example.com'
where not exists (select 1 from client_members where email = 'jane@cdl.example.com');
insert into client_members (name, email)
select 'Teghan Okafor', 'teghan@cdl.example.com'
where not exists (select 1 from client_members where email = 'teghan@cdl.example.com');

insert into client_company_members (member_id, company_id)
select m.id, c.id from client_members m, companies c
where m.email = 'jane@cdl.example.com' and c.name = 'CDL'
on conflict do nothing;
insert into client_company_members (member_id, company_id)
select m.id, c.id from client_members m, companies c
where m.email = 'teghan@cdl.example.com' and c.name = 'CDL'
on conflict do nothing;

-- ── Projects ───────────────────────────────────────────────────────
insert into projects (name, company_id, engagement_type, hourly_rate, monthly_cap_hours, status, notes)
select 'CDL Engagement', c.id, 'retainer', 150, 40, 'active', 'Weekly Loom updates, enrichment pipeline work'
from companies c where c.name = 'CDL'
and not exists (select 1 from projects where name = 'CDL Engagement');

insert into projects (name, company_id, engagement_type, hourly_rate, status, notes)
select 'Koola Outreach', c.id, 'hourly', 125, 'active', 'Gift-brain powered cold outreach'
from companies c where c.name = 'Koola Logistics'
and not exists (select 1 from projects where name = 'Koola Outreach');

insert into projects (name, company_id, engagement_type, hourly_rate, status, notes)
select 'Internal AI Tooling', c.id, 'hourly', 0, 'active', 'Building the company brain'
from companies c where c.name = 'Mad Cactus'
and not exists (select 1 from projects where name = 'Internal AI Tooling');

-- ── Deliverables + updates ─────────────────────────────────────────
insert into deliverables (project_id, title, description, status, sort_order)
select p.id, 'Enrichment pipeline v2', 'n8n → Python migration with measurement hooks', 'in_progress', 1
from projects p where p.name = 'CDL Engagement'
and not exists (select 1 from deliverables d where d.project_id = p.id and d.title = 'Enrichment pipeline v2');

insert into deliverables (project_id, title, description, status, sort_order)
select p.id, 'Weekly Loom cadence', 'Recorded every Tuesday, tracked in the CRM', 'review', 2
from projects p where p.name = 'CDL Engagement'
and not exists (select 1 from deliverables d where d.project_id = p.id and d.title = 'Weekly Loom cadence');

insert into deliverable_updates (deliverable_id, body)
select d.id, 'Chunking + embedding layer wired; awaiting CDL sample data.'
from deliverables d
where d.title = 'Enrichment pipeline v2'
and not exists (select 1 from deliverable_updates u where u.deliverable_id = d.id);

-- ── Time entries ───────────────────────────────────────────────────
insert into time_entries (project_id, entry_date, hours, description, billable)
select p.id, now() - interval '2 days', 3.5, 'Pipeline work', true
from projects p where p.name = 'CDL Engagement'
and not exists (
	select 1 from time_entries t where t.project_id = p.id
	and t.description = 'Pipeline work' and t.entry_date::date = (now() - interval '2 days')::date
);

-- ── Outreach pipeline ──────────────────────────────────────────────
insert into outreach_prospects (company, contact_name, email, stage, next_action_at, next_action_note, notes)
select 'Acme Freight', 'Sam Rivera', 'sam@acmefreight.example.com', 'replied', now() + interval '2 days', 'Send the scoped proposal', 'Met at the logistics meetup; wants agent outreach for freight brokers'
where not exists (select 1 from outreach_prospects where company = 'Acme Freight');

insert into outreach_prospects (company, contact_name, email, stage, notes, brain_url)
select 'Great Lakes Freight', 'Pat Lin', 'pat@greatlakes.example.com', 'watching', 'Sent the gift brain; waiting on video engagement', 'https://greatlakes-brain.fly.dev'
where not exists (select 1 from outreach_prospects where company = 'Great Lakes Freight');

-- ── Email (fake mirror — inbox renders immediately) ────────────────
insert into email_accounts (email, refresh_token)
select 'collin@madcactus.org', 'dev-placeholder'
where not exists (select 1 from email_accounts where email = 'collin@madcactus.org');

-- thread 1: stale unanswered inbound → the brain's detect_loops phase will
-- open an "unanswered_inbound" loop for this on the next cycle
insert into email_threads (account_id, gmail_thread_id, subject, snippet, from_name, from_email, unread, last_message_at)
select a.id, 'dev-thread-1', 'Sample data for the pipeline', 'Attaching the three CSVs you asked about…', 'Jane Doe', 'jane@cdl.example.com', true, now() - interval '5 days'
from email_accounts a
where a.email = 'collin@madcactus.org'
and not exists (select 1 from email_threads where gmail_thread_id = 'dev-thread-1');

insert into email_messages (thread_id, gmail_id, from_name, from_email, to_emails, body_text, date, is_sent)
select t.id, 'dev-msg-1', 'Jane Doe', 'jane@cdl.example.com', 'collin@madcactus.org',
	'Hi Collin — attaching the three CSVs you asked about. The shipping data has a quirks column you should know about. Can you confirm Thursday still works for the walkthrough?',
	now() - interval '5 days', false
from email_threads t where t.gmail_thread_id = 'dev-thread-1'
and not exists (select 1 from email_messages m where m.gmail_id = 'dev-msg-1');

-- thread 2: replied thread (no loop — human answered)
insert into email_threads (account_id, gmail_thread_id, subject, snippet, from_name, from_email, unread, last_message_at)
select a.id, 'dev-thread-2', 'Loom script feedback', 'This version is much better — ship it.', 'Teghan Okafor', 'teghan@cdl.example.com', false, now() - interval '1 days'
from email_accounts a
where a.email = 'collin@madcactus.org'
and not exists (select 1 from email_threads where gmail_thread_id = 'dev-thread-2');

insert into email_messages (thread_id, gmail_id, from_name, from_email, to_emails, body_text, date, is_sent)
select t.id, 'dev-msg-2', 'Teghan Okafor', 'teghan@cdl.example.com', 'collin@madcactus.org',
	'First cut of the Loom script felt stiff. Can you make it more direct?', now() - interval '2 days', false
from email_threads t where t.gmail_thread_id = 'dev-thread-2'
and not exists (select 1 from email_messages m where m.gmail_id = 'dev-msg-2');

insert into email_messages (thread_id, gmail_id, from_name, from_email, to_emails, body_text, date, is_sent)
select t.id, 'dev-msg-3', 'Collin', 'collin@madcactus.org', 'teghan@cdl.example.com',
	'Rewrote the opener — lead with the number, skip the pleasantries. This version is much better.', now() - interval '1 days', true
from email_threads t where t.gmail_thread_id = 'dev-thread-2'
and not exists (select 1 from email_messages m where m.gmail_id = 'dev-msg-3');

-- ── Docs + version history (the diff→lesson corpus) ────────────────
insert into docs (title, markdown, status, chat_uuid)
select 'CDL weekly update', '# CDL weekly update

## Pipeline
Enrichment v2 is in review. Sample data landed.

## Next
Thursday walkthrough with Jane.', 'draft', 'dev-chat-seed-1'
where not exists (select 1 from docs where title = 'CDL weekly update');

insert into text_versions (entity, entity_id, version, author, content)
select 'doc', d.id, 1, 'agent',
	'# CDL weekly update

We are pleased to present the following comprehensive status update regarding the enrichment pipeline v2 initiative.

The sample data has been received and we are currently in the process of reviewing it.'
from docs d
where d.title = 'CDL weekly update'
and not exists (select 1 from text_versions tv where tv.entity = 'doc' and tv.entity_id = d.id);

insert into text_versions (entity, entity_id, version, author, content)
select 'doc', d.id, 2, 'human',
	'# CDL weekly update

## Pipeline
Enrichment v2 is in review. Sample data landed.

## Next
Thursday walkthrough with Jane.'
from docs d
where d.title = 'CDL weekly update'
and not exists (
	select 1 from text_versions tv
	where tv.entity = 'doc' and tv.entity_id = d.id and tv.version = 2
);

-- ── Meetings (transcript with speakers — feeds person pages) ───────
insert into documents (project_id, type, title, content, visibility, transcript_json)
select p.id, 'transcript', 'CDL kickoff — Aug 12', 'Meeting transcript. Teghan wants weekly async summaries instead of calls; Jane flagged data quality in the shipping CSVs as the top risk.', 'internal',
	'[{"speaker":"Teghan","start_ms":0,"end_ms":42000,"text":"Weekly async summaries work better for us than calls. Put it in the shared doc."},
	  {"speaker":"Jane","start_ms":43000,"end_ms":96000,"text":"Biggest risk is data quality in the shipping CSVs — the quirks column breaks our importer."},
	  {"speaker":"Collin","start_ms":97000,"end_ms":120000,"text":"I will build a quirks normalizer before the walkthrough."}]'
from projects p where p.name = 'CDL Engagement'
and not exists (select 1 from documents d where d.title = 'CDL kickoff — Aug 12');

-- ── Slack (fake mirror — feeds extractSlackFacts without a token) ──
insert into slack_channels (slack_id, name, purpose)
select 'CDEV', 'general', 'company-wide chatter'
where not exists (select 1 from slack_channels where slack_id = 'CDEV');
insert into slack_channels (slack_id, name, purpose)
select 'CCDL', 'cdl', 'everything CDL'
where not exists (select 1 from slack_channels where slack_id = 'CCDL');

insert into slack_messages (channel_id, ts, user_id, user_name, text, message_at)
select c.id, '1700000001.000001', 'U1', 'Collin', 'Shipped the quirks normalizer — importer is green.', now() - interval '1 days'
from slack_channels c where c.slack_id = 'CCDL'
and not exists (select 1 from slack_messages m where m.channel_id = c.id and m.ts = '1700000001.000001');

insert into slack_messages (channel_id, ts, user_id, user_name, text, message_at)
select c.id, '1700000002.000001', 'U2', 'Teghan', 'Reminder: CDL walkthrough Thursday. Jane confirmed.', now() - interval '3 hours'
from slack_channels c where c.slack_id = 'CCDL'
and not exists (select 1 from slack_messages m where m.channel_id = c.id and m.ts = '1700000002.000001');

insert into slack_messages (channel_id, ts, user_id, user_name, text, message_at)
select c.id, '1700000003.000001', 'U1', 'Collin', 'Brain cycle extracted 12 facts overnight — intake loops look right.', now() - interval '2 hours'
from slack_channels c where c.slack_id = 'CDEV'
and not exists (select 1 from slack_messages m where m.channel_id = c.id and m.ts = '1700000003.000001');

-- ── Invoices ───────────────────────────────────────────────────────
insert into invoices (project_id, number, amount, status, issue_date, due_date, notes)
select p.id, 'DEV-0001', 2250, 'sent', now() - interval '10 days', now() + interval '5 days', 'Seed invoice'
from projects p where p.name = 'CDL Engagement'
and not exists (select 1 from invoices i where i.number = 'DEV-0001');
