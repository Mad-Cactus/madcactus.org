-- Mad Cactus client dashboard — Phase 1 schema
-- Run in Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)
-- Re-runnable: uses IF NOT EXISTS / OR REPLACE.

-- ── Projects / Engagements ──────────────────────────────────────────
create table if not exists projects (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    client_name text not null,
    -- retainer  = recurring monthly hours at a cap
    -- hourly    = billed per hour, no cap
    -- project   = fixed-price engagement
    engagement_type text not null default 'hourly'
        check (engagement_type in ('retainer', 'hourly', 'project')),
    hourly_rate numeric(10, 2) not null default 0,
    -- only meaningful for retainer; null = uncapped
    monthly_cap_hours numeric(7, 2),
    status text not null default 'active'
        check (status in ('active', 'paused', 'completed')),
    -- free-text: what's planned / scope notes
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ── Time entries ────────────────────────────────────────────────────
create table if not exists time_entries (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects(id) on delete cascade,
    entry_date date not null default current_date,
    hours numeric(5, 2) not null check (hours > 0),
    description text not null,
    billable boolean not null default true,
    created_at timestamptz not null default now()
);

create index if not exists idx_time_entries_date on time_entries (entry_date desc);
create index if not exists idx_time_entries_project on time_entries (project_id);

-- keep updated_at fresh
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;
drop trigger if exists trg_projects_touch on projects;
create trigger trg_projects_touch before update on projects
    for each row execute function touch_updated_at();

-- ── Row Level Security ──────────────────────────────────────────────
-- Phase 1 is admin-only: any authenticated user has full access.
-- When the client portal ships, scope these by a projects.client_user_id.
alter table projects enable row level security;
alter table time_entries enable row level security;

drop policy if exists "admin full access projects" on projects;
create policy "admin full access projects" on projects
    for all to authenticated using (true) with check (true);

drop policy if exists "admin full access time_entries" on time_entries;
create policy "admin full access time_entries" on time_entries
    for all to authenticated using (true) with check (true);

-- Grant table privileges to Supabase roles (required for PostgREST/RLS)
grant all on public.projects to anon, authenticated, service_role;
grant all on public.time_entries to anon, authenticated, service_role;

-- ── Helpful view: monthly hours per project ─────────────────────────
create or replace view monthly_hours_by_project as
select
    p.id as project_id,
    p.name as project_name,
    date_trunc('month', t.entry_date) as month,
    sum(t.hours) as hours
from projects p
join time_entries t on t.project_id = p.id
group by p.id, p.name, date_trunc('month', t.entry_date);
