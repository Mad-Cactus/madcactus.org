#!/usr/bin/env bash
# One-command dev environment: fresh clone → working dashboard + seeded brain.
#
#   ./scripts/dev-setup.sh          → Postgres + schema + seed (use `bun run dev`)
#   ./scripts/dev-setup.sh --app    → also start the app container on :3000
#   ./scripts/dev-teardown.sh       → remove everything (containers, data, .env)
#
# No API keys required — every integration (LLM, Gmail, Slack, embeddings)
# degrades gracefully. Add real keys in dashboard/.env when you want them.
set -euo pipefail
cd "$(dirname "$0")/.."

DB_URL="${DB_URL:-postgres://postgres:postgres@localhost:5434/madcactus}"

[ -f dashboard/.env ] || { cp dashboard/.env.example dashboard/.env; echo "→ created dashboard/.env from example (all integrations off until you add keys)"; }

echo "→ starting Postgres"
docker compose up -d db
until docker compose exec -T db pg_isready -U postgres -d madcactus >/dev/null 2>&1; do sleep 1; done

cd dashboard
[ -d node_modules ] || { echo "→ bun install"; rtk bun install; }

echo "→ schema push"
DATABASE_URL="$DB_URL" bun run db:push --force

echo "→ seed"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f ../supabase/seed.sql

if [[ "${1:-}" == "--app" ]]; then
	echo "→ starting app container (http://localhost:3000)"
	cd .. && rtk docker compose --profile app up -d app
	cd dashboard
fi

cat <<'TIP'

Dev environment ready.
  bun run dev            → dev server (hot reload)
  Admin:                 → http://localhost:3000/admin  (login via hosted Supabase)
  Brain page:            → /admin/brain → "Run cycle" fills brain_* from the seed corpus

Optional keys (dashboard/.env) — everything works without them:
  OPENROUTER_API_KEY     → LLM distillation: facts, diff lessons, transcripts, takes, briefs
  SLACK_BOT_TOKEN        → real slack sync (seeded fake slack already distills)
  GMAIL OAuth            → dashboard → Email → connect (seeded fake email renders now)
TIP
