-- ── Seed: client portal data ──────────────────────────────────────
-- Portal login = a client_members row (this file) + a Supabase Auth user with
-- the same email (auth is hosted; create it with the real keys:
--   curl -X POST "$SUPABASE_URL/auth/v1/signup" -H "apikey: $SUPABASE_ANON_KEY" \
--     -H 'content-type: application/json' -d '{"email":"client@cdl.example","password":"..."}'
-- ). password_hash is legacy/unused (schema.ts: Supabase Auth is the password store).

-- Client portal member
insert into client_members (name, email, is_active)
values ('CDL Admin', 'client@cdl.example', true)
on conflict (email) do nothing;

-- ── Documents ─────────────────────────────────────────────────────
insert into documents (project_id, type, title, url, description, visibility)
select p.id, 'link', 'Project Brief — CDL Agent', 'https://docs.google.com/document/d/example-project-brief',
       'Shared Google Doc with project scope, milestones, and success metrics', 'client'
from projects p where p.name = 'CDL Engagement'
on conflict do nothing;

insert into documents (project_id, type, title, url, description, visibility)
select p.id, 'link', 'Architecture Diagram', 'https://docs.google.com/drawings/d/example-arch-diagram',
       'Intelligence layer architecture — proposed system design', 'client'
from projects p where p.name = 'CDL Engagement'
on conflict do nothing;

insert into documents (project_id, type, title, description, visibility)
select p.id, 'transcript', 'Discovery Call — July 15', 'Initial discovery call transcript. Covered current pain points, desired automation, and timeline.', 'client'
from projects p where p.name = 'CDL Engagement'
on conflict do nothing;

-- ── Invoices ──────────────────────────────────────────────────────
insert into invoices (project_id, number, amount, status, issue_date, due_date, payment_url, notes)
select p.id, 'INV-2026-001', 6000.00, 'sent',
       (current_date - interval '10 days')::date,
       (current_date + interval '20 days')::date,
       'https://stripe.com/invoice/example-001',
       'July retainer — 40h at $150/hr'
from projects p where p.name = 'CDL Engagement'
on conflict do nothing;

insert into invoices (project_id, number, amount, status, issue_date, due_date, notes)
select p.id, 'INV-2026-002', 1500.00, 'draft',
       current_date,
       (current_date + interval '30 days')::date,
       'Additional development hours — 10h overage at $150/hr'
from projects p where p.name = 'CDL Engagement'
on conflict do nothing;
