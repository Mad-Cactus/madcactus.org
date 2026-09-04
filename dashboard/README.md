# Mad Cactus Dashboard

SolidStart + Nitro + Postgres (Drizzle) + Supabase auth. Deployed to fly as
`madcactus-dashboard`.

## Local development

Auth runs against the hosted Supabase project; Postgres + the app run locally
via Docker Compose (repo root).

**One-time setup**

```bash
docker compose up -d                 # Postgres on localhost:5434
cd dashboard
bun install
bun run db:push                      # schema into the local DB
```

`dashboard/.env` must exist with at least `DATABASE_URL` (compose prints its
URL) and the `SUPABASE_*` keys. Copy values from fly secrets
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
