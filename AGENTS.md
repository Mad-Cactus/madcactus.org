# AGENTS.md

## Database migrations — always drizzle-kit, never hand-written SQL

Schema changes live in `dashboard/src/db/schema.ts`. Migrations are GENERATED, not authored:

```bash
cd dashboard
bun run db:generate   # drizzle-kit generate → supabase/migrations/<timestamp>_name.sql + meta snapshot + journal entry
```

- **Never write a `.sql` file in `supabase/migrations/` by hand, and never rename/rename-number one after generating.** The `meta/` snapshots and `_journal.json` are drizzle's source of truth; a hand-written or misnumbered migration desyncs them and the next generated migration will try to re-create (or drop) real tables.
- `drizzle.config.ts` sets `migrations.prefix = "supabase"` → filenames are `YYYYMMDDHHMMSS_name.sql`, which sort AFTER all older migrations. drizzle's default `00NN_` index prefix sorts BEFORE `2026…` files and breaks filename-order replay (CI + `supabase db push`). Keep the supabase prefix.
- Always commit the generated `.sql` AND `supabase/migrations/meta/*` (snapshot + journal) together.
- Apply with `bun run db:push` (or `supabase db push`) — don't run migration SQL manually.
- CI (`.github/workflows/migrations.yml`) replays every migration in filename order on a fresh database and fails if any `.sql` is missing from the journal. Run the same replay locally before pushing if you touched migrations.
- If history is already broken (dup/misnumbered file): delete the bad `.sql` + its snapshot + journal entry, regenerate from schema.ts, and guard any table that may already exist on prod with `CREATE TABLE IF NOT EXISTS` — see `20260908213612_short_links_voice_lesson_reviews.sql`.
