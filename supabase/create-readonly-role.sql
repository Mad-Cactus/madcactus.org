-- One-time setup: read-only prod access for local dev (run in Supabase SQL Editor).
--
-- Creates role `app_ro`: SELECT on all current AND future public tables, zero write
-- grants. Local dev uses it via scripts/pull-env.sh --prod-db to test against real
-- data without any write path to prod.
--
-- 1. Pick a password, replace CHANGE-ME below (both spots), run this file.
-- 2. Add to dashboard/.env (survives re-pulls — pull-env preserves it):
--      PROD_RO_DB_URL=postgres://app_ro:CHANGE-ME@aws-0-<region>.pooler.supabase.com:5432/postgres
-- 3. ./scripts/pull-env.sh --prod-db
--
-- ponytail: this is NOT a migration (AGENTS.md) — run once by hand, role state
-- lives in prod. Default-privilege grant only covers tables created by the role
-- you run this as (postgres); tables created by other roles need the grant re-run.
-- Rotate the password here + in dashboard/.env whenever you like:
--   alter role app_ro password '<new>';

do $$
begin
	if not exists (select 1 from pg_roles where rolname = 'app_ro') then
		create role app_ro login password 'CHANGE-ME'
			nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
	else
		alter role app_ro password 'CHANGE-ME';
	end if;
end $$;

revoke all on schema public from app_ro;
grant usage on schema public to app_ro;
grant select on all tables in schema public to app_ro;
alter default privileges in schema public grant select on tables to app_ro;

-- Verify:
--   set role app_ro; select count(*) from companies;          -- works
--   set role app_ro; insert into companies (name) values ('x'); -- must fail
--   reset role;
