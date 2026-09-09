#!/usr/bin/env bash
# One-command dev environment: fresh clone/worktree → working dashboard + seeded brain.
#
#   ./scripts/dev-setup.sh           → real env from Fly + Postgres + schema + seed
#   ./scripts/dev-setup.sh --example → skip the Fly pull, use .env.example placeholders
#   ./scripts/dev-setup.sh --prod-db → DATABASE_URL = read-only prod role (test against real data;
#                                      writes only via the local worktree DB, see README)
#   ./scripts/dev-teardown.sh        → remove everything (containers, data, .env)
#
# Auth stays on the hosted Supabase project; every integration key comes from prod
# via scripts/pull-env.sh, so Gmail/Slack/LLM/etc. work locally immediately.
set -euo pipefail
cd "$(dirname "$0")/.."

ARG="${1:-}"

# Compose selection: the main checkout keeps docker-compose.yml on :5434 (existing
# volume + brain-db container live there). Every other checkout is treated as a
# worktree and gets a stable per-directory port so parallel worktrees never collide.
# ponytail: port ceiling is 5435–6524; if you ever need a fixed port, set WORKTREE_DB_PORT.
ROOT=$PWD
DIR=$(basename "$PWD")
if [[ "$DIR" == "madcactus.org" ]]; then
	COMPOSE=(docker compose -p "$DIR")
	PORT="${WORKTREE_DB_PORT:-5434}"
else
	COMPOSE=(docker compose -p "$DIR" -f "$ROOT/docker-compose.worktree.yml")
	PORT="${WORKTREE_DB_PORT:-$((5435 + $(printf %s "$DIR" | cksum | cut -d' ' -f1) % 90))}"
fi
DB_URL="${DB_URL:-postgres://postgres:postgres@localhost:$PORT/madcactus}"

if [[ "$ARG" == "--example" ]]; then
	[ -f dashboard/.env ] || { cp dashboard/.env.example dashboard/.env; echo "→ created dashboard/.env from example (integrations off until keys added)"; }
else
	# --prod-db passes through; otherwise pull-env overrides DATABASE_URL to the local DB above.
	DEV_DATABASE_URL="$DB_URL" ./scripts/pull-env.sh "$ARG"
fi

echo "→ starting Postgres on :$PORT"
WORKTREE_DB_PORT=$PORT "${COMPOSE[@]}" up -d
until "${COMPOSE[@]}" exec -T db pg_isready -U postgres -d madcactus >/dev/null 2>&1; do sleep 1; done

cd dashboard
[ -d node_modules ] || { echo "→ bun install"; bun install; }

# Guard lives in scripts/db-guard.sh — refuses non-local DATABASE_URL (prod safety).
echo "→ schema push"
DATABASE_URL="$DB_URL" bun run db:push --force

# Seed only when empty — seed.sql is not idempotent.
ROWCOUNT=$("${COMPOSE[@]}" exec -T db psql -U postgres -tA -d madcactus -c 'select count(*) from companies;' 2>/dev/null || echo 0)
if [[ "${ROWCOUNT// /}" -gt 0 ]]; then
	echo "→ seed: database already has data, skipping"
else
	echo "→ seeding (corpus + portal users)"
	"${COMPOSE[@]}" exec -T db psql -U postgres -d madcactus -v ON_ERROR_STOP=1 < ../supabase/seed.sql
	"${COMPOSE[@]}" exec -T db psql -U postgres -d madcactus -v ON_ERROR_STOP=1 < ../supabase/seed-portal.sql
fi
cd ..

cat <<TIP

Dev environment ready (DATABASE_URL → localhost:$PORT).
  cd dashboard && bun run dev   → http://localhost:3000/admin
  Portal login:                 → seeded portal user (supabase/seed-portal.sql)

dashboard/.env holds the REAL prod keys (Gmail OAuth, Slack, LLM, Resend…).
Override anything by editing it — pull-env backs up your edits to .env.bak
before the next pull.
TIP
