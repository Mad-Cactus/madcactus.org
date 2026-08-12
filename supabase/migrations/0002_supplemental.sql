-- Supplemental SQL: things Drizzle can't express.
-- Run once after the Drizzle baseline migration (0000_*).

-- Storage bucket for portal document/file uploads.
-- Drizzle manages tables; storage buckets are Supabase-specific.
insert into storage.buckets (id, name, public)
values ('portal-docs', 'portal-docs', false)
on conflict (id) do nothing;
