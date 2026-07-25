-- Deliverables: client-visible milestones with progress updates
-- Hours stay admin-only; clients see deliverables + status + updates

create table if not exists deliverables (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects(id) on delete cascade,
    title text not null,
    description text default '',
    status text not null default 'planned'
        check (status in ('planned', 'in_progress', 'review', 'completed', 'blocked')),
    sort_order int not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists deliverable_updates (
    id uuid primary key default gen_random_uuid(),
    deliverable_id uuid not null references deliverables(id) on delete cascade,
    body text not null,
    created_at timestamptz not null default now()
);

create index if not exists idx_deliverables_project on deliverables(project_id);
create index if not exists idx_deliverable_updates_deliverable on deliverable_updates(deliverable_id);

grant select on deliverables to anon, authenticated, service_role;
grant select on deliverable_updates to anon, authenticated, service_role;
grant all on deliverables to service_role;
grant all on deliverable_updates to service_role;

-- Seed deliverables for CDL Engagement
insert into deliverables (project_id, title, description, status, sort_order)
select p.id, 'Discovery & Requirements', 'Stakeholder interviews, current process audit, requirements documentation.', 'completed', 0
from projects p where p.name = 'CDL Engagement'
on conflict do nothing;

insert into deliverables (project_id, title, description, status, sort_order)
select p.id, 'Agent Architecture Design', 'System design for the AI scheduling agent — data flows, model selection, integration points.', 'completed', 1
from projects p where p.name = 'CDL Engagement'
on conflict do nothing;

insert into deliverables (project_id, title, description, status, sort_order)
select p.id, 'Prototype Scheduling Agent', 'Working prototype that handles driver assignment for single-region routes.', 'in_progress', 2
from projects p where p.name = 'CDL Engagement'
on conflict do nothing;

insert into deliverables (project_id, title, description, status, sort_order)
select p.id, 'Production Deployment', 'Deploy to production, integrate with existing TMS, run pilot with 3 dispatchers.', 'planned', 3
from projects p where p.name = 'CDL Engagement'
on conflict do nothing;

-- Seed updates
insert into deliverable_updates (deliverable_id, body)
select d.id, 'Completed stakeholder interviews with 4 dispatchers and 2 ops managers. Key pain point: manual assignment takes 2+ hours per shift.'
from deliverables d where d.title = 'Discovery & Requirements'
on conflict do nothing;

insert into deliverable_updates (deliverable_id, body)
select d.id, 'Requirements doc approved by client. Scope locked to single-region pilot.'
from deliverables d where d.title = 'Discovery & Requirements'
on conflict do nothing;

insert into deliverable_updates (deliverable_id, body)
select d.id, 'Architecture finalized. Using OpenAI function-calling with a constraint solver for hard scheduling rules.'
from deliverables d where d.title = 'Agent Architecture Design'
on conflict do nothing;

insert into deliverable_updates (deliverable_id, body)
select d.id, 'Prototype handles 80% of test cases. Working on edge cases with multi-stop routes and driver hour limits (HOS compliance).'
from deliverables d where d.title = 'Prototype Scheduling Agent'
on conflict do nothing;
