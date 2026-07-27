-- ── Seed: client portal data ──────────────────────────────────────
-- Uses fixed salt for reproducible seed. App hashes with scrypt + random salt.

-- Client linked to CDL Engagement project
insert into clients (project_id, name, email, password_hash, is_active)
select p.id, 'CDL Admin', 'client@cdl.example',
       'a1b2c3d4e5f67890:772e0cc20a98209a154be0f8b4a1c1ccfe119a2542ff67f3b0473bc12ec7dfb2d5d3ba1718aac622fa15415ded6a838219597483d9466f5463377baba56d4199',
       true
from projects p where p.name = 'CDL Engagement'
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
