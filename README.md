# madcactus.org

Mad Cactus monorepo.

| Path | What | Stack |
| --- | --- | --- |
| `dashboard/` | Ops dashboard (app.madcactus.org) — email, docs, redline, meetings | SolidStart + Nitro, Postgres (Supabase), deployed to Fly (`fly deploy` from `dashboard/`) |
| `marketing/` | Public site + newsletter | Astro |
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
