# AGENTS.md

## Project philosophy: first-class components

This codebase exists to run a consulting firm. Every business object in that firm — email, campaign, video, meeting, contact, company, project, doc, invoice, deliverable, short link — is a **first-class component**. That is a code constraint, not a vibe:

1. **The registry is the map of the business.** `dashboard/src/registry/registry.ts` defines every component in one file — kind, label, teaching description, status vocabulary, links. Read it first when you need to know what exists; it replaces paraphrasing the schema.
2. **Adding a business object = `defineComponent()` + its own table + an admin route + registration in the registry.** Never bolt columns onto another component's table (videos were 9 columns on `outreach_prospects` before they were promoted — that was the anti-pattern). Never invent a new bespoke linking scheme.
3. **Ownership vs reference.** Real FKs mean ownership and cascade deletes (project → company, video → prospect). Cross-references and mentions (`@[kind:id]` in docs, agent-created links) go in `entity_links` — a deleted target degrades to a "deleted" card, it never cascades. Existing FKs were NOT migrated into `entity_links`; `get_component`/`list_links` report both.
4. **Before hand-rolling an MCP tool, check `list_component_types`** on `/api/brain-mcp`. Generic component tools (`get_component`, `search_components`, `link_components`, `list_links`, `create_video`) already cover the registry; new components get MCP presence for free from here on.
5. **State is public.** Every component exposes a card (title, status, subtitle, links) via `resolveCard`. Build views, mentions, and hover states on cards — not bespoke per-page queries.

Deliberately NOT registered: the brain subsystem (`brain_pages`, `brain_facts`, …) keeps its own vocabulary (entity slugs). Unifying the two is a future, explicit decision.

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
