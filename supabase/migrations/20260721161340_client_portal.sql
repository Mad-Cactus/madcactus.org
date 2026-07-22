-- ── Client Portal Tables ───────────────────────────────────────────
-- Clients link to projects. Admin sets their password.
-- Documents, invoices, and API keys are scoped per client.

-- ── Clients ────────────────────────────────────────────────────────
create table if not exists clients (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects(id) on delete cascade,
    name text not null,
    email text not null unique,
    -- scrypt hash: "salt:hash"
    password_hash text not null,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_clients_project on clients (project_id);
create index if not exists idx_clients_email on clients (email);

-- ── Documents ──────────────────────────────────────────────────────
-- type: 'link' (external URL like Google Docs), 'file' (uploaded PDF/doc), 'transcript' (meeting transcript)
create table if not exists documents (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects(id) on delete cascade,
    type text not null default 'link'
        check (type in ('link', 'file', 'transcript')),
    title text not null,
    -- for type='link': external URL; for type='file'/'transcript': storage path
    url text,
    -- for uploaded files: original filename + mime type
    file_name text,
    file_size bigint,
    mime_type text,
    -- free-text description
    description text,
    -- who can see it: 'client' (client portal), 'internal' (admin only)
    visibility text not null default 'client'
        check (visibility in ('client', 'internal')),
    created_at timestamptz not null default now()
);

create index if not exists idx_documents_project on documents (project_id);

-- ── Invoices ───────────────────────────────────────────────────────
create table if not exists invoices (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects(id) on delete cascade,
    number text not null,
    amount numeric(10, 2) not null,
    -- draft | sent | paid | void
    status text not null default 'draft'
        check (status in ('draft', 'sent', 'paid', 'void')),
    issue_date date not null default current_date,
    due_date date,
    -- optional payment URL (Stripe, etc.)
    payment_url text,
    -- optional uploaded PDF storage path
    file_name text,
    file_size bigint,
    storage_path text,
    notes text,
    created_at timestamptz not null default now()
);

create index if not exists idx_invoices_project on invoices (project_id);

-- ── API Keys ───────────────────────────────────────────────────────
-- Clients generate keys to use with the MCP server.
-- Key format: "mc_" + 32 hex chars. Only the hash is stored.
create table if not exists api_keys (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references clients(id) on delete cascade,
    label text not null default 'Default',
    -- SHA-256 hash of the full key
    key_hash text not null unique,
    -- first 8 chars shown for identification (e.g. "mc_a1b2c3d4")
    key_prefix text not null,
    last_used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists idx_api_keys_client on api_keys (client_id);
create index if not exists idx_api_keys_hash on api_keys (key_hash);

-- ── Triggers ───────────────────────────────────────────────────────
drop trigger if exists trg_clients_touch on clients;
create trigger trg_clients_touch before update on clients
    for each row execute function touch_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────
-- Admin (authenticated Supabase users) has full access.
-- Client portal uses service_role key with app-level scoping.
alter table clients enable row level security;
alter table documents enable row level security;
alter table invoices enable row level security;
alter table api_keys enable row level security;

drop policy if exists "admin full access clients" on clients;
create policy "admin full access clients" on clients
    for all to authenticated using (true) with check (true);

drop policy if exists "admin full access documents" on documents;
create policy "admin full access documents" on documents
    for all to authenticated using (true) with check (true);

drop policy if exists "admin full access invoices" on invoices;
create policy "admin full access invoices" on invoices
    for all to authenticated using (true) with check (true);

drop policy if exists "admin full access api_keys" on api_keys;
create policy "admin full access api_keys" on api_keys
    for all to authenticated using (true) with check (true);

-- Grants
grant all on public.clients to anon, authenticated, service_role;
grant all on public.documents to anon, authenticated, service_role;
grant all on public.invoices to anon, authenticated, service_role;
grant all on public.api_keys to anon, authenticated, service_role;

-- ── Storage bucket for file uploads ────────────────────────────────
insert into storage.buckets (id, name, public)
values ('portal-docs', 'portal-docs', false)
on conflict (id) do nothing;

-- Service role can manage storage objects; authenticated can read
-- (signed URLs used for client downloads)
