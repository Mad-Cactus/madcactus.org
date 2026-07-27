-- Mad Cactus seed data
-- `supabase db seed` runs this after migrations, as the postgres superuser.

-- ── Projects ───────────────────────────────────────────────────────
insert into projects (name, client_name, engagement_type, hourly_rate, monthly_cap_hours, status, notes) values
(
    'CDL Engagement',
    'CDL',
    'retainer',
    150.00,
    40,
    'active',
    null  -- scope TBD, edit from dashboard
),
(
    'Internal AI Tooling',
    'Mad Cactus',
    'hourly',
    0,
    null,
    'active',
    'Internal work — agent frameworks, infra, R&D. Non-billable.'
);

-- ── Time entries ───────────────────────────────────────────────────
insert into time_entries (project_id, entry_date, hours, description, billable)
select p.id, t.entry_date, t.hours, t.description, t.billable
from projects p
join (values
    -- CDL: retainer, ~18h used this month out of 40h cap (45%)
    ('CDL Engagement', current_date :: date,                    3.0,  'Discovery call + workflow mapping session', true),
    ('CDL Engagement', (current_date - interval '1 day')::date, 4.0,  'Built initial agent prototype, tested against sample data', true),
    ('CDL Engagement', (current_date - interval '2 days')::date, 2.5, 'Reviewed their existing tooling, identified quick wins', true),
    ('CDL Engagement', (current_date - interval '3 days')::date, 5.0, 'Architecture doc: intelligence layer design proposal', true),
    ('CDL Engagement', (current_date - interval '5 days')::date, 3.5, 'Client sync on scope, refined engagement terms', true),
    -- Internal: non-billable
    ('Internal AI Tooling', (current_date - interval '1 day')::date, 2.0, 'SolidStart dashboard build — auth + time tracking', false),
    ('Internal AI Tooling', (current_date - interval '4 days')::date, 1.5, 'Supabase schema design + RLS policies', false)
) as t(project_name, entry_date, hours, description, billable)
on p.name = t.project_name;
