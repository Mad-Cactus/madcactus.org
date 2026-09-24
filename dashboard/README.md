# Mad Cactus Dashboard

SolidStart + Nitro + Postgres (Drizzle) + Supabase auth. Deployed to fly as
`madcactus-dashboard`.

## Local development

Auth runs against the local Supabase stack. One command from the repo root sets
everything up:

```bash
./scripts/dev-setup.sh               # env + shared local Supabase stack (Postgres :54322) + schema + seed
```

The stack is machine-global: auth, storage and the app Postgres all live in it,
every worktree shares its data by design, and `supabase stop` stops it for the
whole machine. `bun run dev` logs in as admin@madcactus.org / cactus-local-dev.
Studio (storage bucket, auth users, table editor): http://localhost:54323.

`dashboard/.env` must exist with at least `DATABASE_URL` (dev-setup writes it)
and the `SUPABASE_*` keys. Copy values from fly secrets
(`fly ssh console -a madcactus-dashboard -C "printenv SUPABASE_URL"`).

**Every day**

```bash
bun run dev        # hot-reload dev server (uses dashboard/.env)
```

Log in with a Supabase user from the hosted project.

**Test the production artifact** (the same image fly runs):

```bash
docker compose up --build app     # http://localhost:3001
```

**Tests / typecheck**

```bash
bun run test        # pure-function tests; no real DB needed
bun run typecheck
```

## Notes

- `supabase/seed.sql` is stale relative to the current schema — don't apply it
  to a fresh DB without reviewing.
- Schema changes: edit `src/db/schema.ts`, then `bun run db:generate` to add a
  migration under `supabase/migrations/`.
