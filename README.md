# madcactus.org

Mad Cactus monorepo.

| Path | What | Stack |
| --- | --- | --- |
| `dashboard/` | The whole site — marketing (madcactus.org, prerendered), app (app.madcactus.org/admin), live Cactus Dispatch issues (SSR from DB) | SolidStart + Nitro, Postgres (Supabase), deployed to Fly (`fly deploy` from `dashboard/`) |
| `supabase/` | DB config, migrations, seed data | Supabase |
| `tools/` | Meeting publisher service | Bun |

## Dashboard quickstart

```sh
cd dashboard
bun install
cp .env.example .env   # fill in real values
bun run db:push        # local dev uses Docker postgres
bun dev
```

Commit hook typechecks (`bunx tsc --noEmit`) — run `bun install` first.

## Schema changes

The migrations folder (`supabase/migrations/`) is written to by drizzle-kit AND auto-applied to
prod by the Supabase GitHub integration on merge to main. One folder, strict rules:

- Schema lives in `dashboard/src/db/schema.ts`. Change it there, then
  `cd dashboard && bun run db:generate` → commit the generated migration.
- SQL drizzle can't express: `bunx drizzle-kit generate --custom`, then edit the new file.
  The `--custom` step keeps the journal in sync — never drop a bare `.sql` file in the folder.
- `bun run db:push` (drizzle-kit push) is for the **local Docker Postgres only**.
  Never run it against Supabase prod — it bypasses migration history and desyncs it
  (this has happened; fixing it needs `supabase migration repair`).
- CI (`.github/workflows/migrations.yml`) replays every migration on a fresh database
  and fails PRs that aren't registered in the drizzle journal. Both must be green before merge.
- Current state: squashed to `20260907175653_baseline.sql` (dump of prod, 2026-09-07).
  28 prior migrations deleted; drizzle journal/snapshots kept so `db:generate` still
  diffs correctly.
- Cron jobs (`brain-cycle`, `scheduler-tick`) live in
  `20260907181000_cron_jobs.sql` — `cron.schedule()` replaces by name, so it's
  idempotent and auto-applied. To change a schedule: new migration, same job name.
  One-time per environment (SQL editor, value never in git):
  `select vault.create_secret('<CRON_SECRET>', 'brain-cron-secret');`
  matching `CRON_SECRET` on Fly.
