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

# Fresh database? Prefer a real prod snapshot over the synthetic seed — real
# emails/docs/brain facts make local testing meaningful. Snapshot cache is shared
# across worktrees and refreshed at most daily (REFRESH_PROD=1 forces it).
# Source URL: dashboard/.env PROD_RO_DB_URL (pull-env writes it from the Keychain
# cache). pg_cron/pg_net/vault extensions don't exist locally — pg_restore reports
# those errors and continues; everything else lands.
RESTORED=0
ROWCOUNT=$("${COMPOSE[@]}" exec -T db psql -U postgres -tA -d madcactus -c 'select count(*) from companies;' 2>/dev/null || echo 0)
if [[ "${ROWCOUNT// /}" -eq 0 ]]; then
	PROD_URL=$(grep -h '^PROD_RO_DB_URL=' dashboard/.env 2>/dev/null | tail -1 | cut -d= -f2- || true)
	if [[ -z "$PROD_URL" ]]; then
		PROD_URL=$(security find-generic-password -s madcactus-dashboard-env -w 2>/dev/null | base64 -d 2>/dev/null | grep '^PROD_RO_DB_URL=' | tail -1 | cut -d= -f2- || true)
	fi
	if [[ -n "${PROD_URL:-}" ]]; then
		CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/madcactus"
		mkdir -p "$CACHE_DIR"
		(
			# flock is Linux-only — guard the shared dump with a mkdir lock (atomic
			# on POSIX). Wait ≤60s for a concurrent worktree, then proceed unlocked:
			# a torn snapshot only costs us the seed fallback.
			LOCKED=0
			for _ in $(seq 60); do
				if mkdir "$CACHE_DIR/.dump.lock" 2>/dev/null; then LOCKED=1; break; fi
				sleep 1
			done
			trap '[[ $LOCKED == 1 ]] && rmdir "$CACHE_DIR/.dump.lock" 2>/dev/null' EXIT
			STALE=1
			if [[ -s "$CACHE_DIR/prod.dump" ]]; then
				AGE=$(( $(date +%s) - $(stat -f %m "$CACHE_DIR/prod.dump") ))
				[[ $AGE -lt $((24 * 3600)) ]] && STALE=0
			fi
			if [[ $STALE -eq 1 || "${REFRESH_PROD:-0}" == "1" ]]; then
				echo "→ dumping prod snapshot → $CACHE_DIR/prod.dump (shared cache, ≤1/day)"
				docker run --rm -v "$CACHE_DIR":/out -e PURL="$PROD_URL" pgvector/pgvector:pg17 \
					sh -c 'pg_dump "$PURL" -Fc --no-owner --no-privileges --no-tablespaces -f /out/prod.dump.tmp' \
				|| { echo "→ prod dump failed — falling back to seed"; exit 0; }
				mv "$CACHE_DIR/prod.dump.tmp" "$CACHE_DIR/prod.dump"
			fi
		)
		if [[ -s "$CACHE_DIR/prod.dump" ]]; then
			echo "→ restoring prod snapshot into :$PORT"
			"${COMPOSE[@]}" exec -T db psql -U postgres -d madcactus -c 'create extension if not exists vector;' >/dev/null 2>&1 || true
			RESTORE_ERR=$(mktemp)
			"${COMPOSE[@]}" exec -T db pg_restore -U postgres -d madcactus --no-owner --no-privileges <"$CACHE_DIR/prod.dump" 2>"$RESTORE_ERR" || true
			grep -c error "$RESTORE_ERR" >/dev/null 2>&1 && echo "   ($(grep -c 'error:' "$RESTORE_ERR" || true) restore errors — extension-only, expected)"
			ROWCOUNT2=$("${COMPOSE[@]}" exec -T db psql -U postgres -tA -d madcactus -c 'select count(*) from companies;' 2>/dev/null || echo 0)
			[[ "${ROWCOUNT2// /}" -gt 0 ]] && RESTORED=1
			rm -f "$RESTORE_ERR"
		fi
	fi
fi

cd dashboard
[ -d node_modules ] || { echo "→ bun install"; bun install; }

if [[ $RESTORED -eq 1 ]]; then
	echo "→ schema = prod snapshot; skipped db:push + seed (if this branch adds migrations, run: DATABASE_URL=$DB_URL bun run db:push)"
else
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
fi
cd ..

# Local Supabase stack for AUTH + STORAGE (videos bucket, no hosted 50MB cap).
# The stack is machine-global (one per machine — container names come from the
# committed config.toml), so `start` is a no-op if another worktree already runs
# it. App DATABASE_URL keeps pointing at the compose DB above: auth users live
# in the stack's own Postgres and never join app tables.
if command -v supabase >/dev/null; then
	echo "→ local Supabase stack (auth+storage :54321, Studio :54323)"
	supabase start >/dev/null
	STATUS=$(supabase status -o json 2>/dev/null)
	API_URL=$(echo "$STATUS" | grep -o '"API_URL": "[^"]*"' | cut -d'"' -f4)
	ANON=$(echo "$STATUS" | grep -o '"ANON_KEY": "[^"]*"' | cut -d'"' -f4)
	SVC=$(echo "$STATUS" | grep -o '"SERVICE_ROLE_KEY": "[^"]*"' | cut -d'"' -f4)
	if [ -n "$API_URL" ] && [ -n "$ANON" ] && [ -n "$SVC" ] && [ ! -f dashboard/.env.local ]; then
		cat > dashboard/.env.local <<LOCAL
# Local Supabase overrides (dev only) — written by scripts/dev-setup.sh.
# Point the database here instead to use the stack's own Postgres (:54322).
SUPABASE_URL=$API_URL
SUPABASE_ANON_KEY=$ANON
SUPABASE_SERVICE_KEY=$SVC
DEV_ADMIN_EMAIL=admin@madcactus.org
DEV_ADMIN_PASSWORD=cactus-local-dev
LOCAL
		echo "→ wrote dashboard/.env.local (local auth + storage; login: admin@madcactus.org / cactus-local-dev)"
	fi
	# Dev admin user for the local auth — 422 = already exists, fine.
	curl -s -o /dev/null -m 10 -X POST "$API_URL/auth/v1/signup" \
		-H "apikey: $ANON" -H "Content-Type: application/json" \
		-d '{"email":"admin@madcactus.org","password":"cactus-local-dev"}' || true
fi

cat <<TIP

Dev environment ready (DATABASE_URL → localhost:$PORT).
  cd dashboard && bun run dev   → http://localhost:3000/admin
  Portal login:                 → seeded portal user (supabase/seed-portal.sql)

dashboard/.env holds the REAL prod keys (Gmail OAuth, Slack, LLM, Resend…).
Override anything by editing it — pull-env backs up your edits to .env.bak
before the next pull.
TIP
