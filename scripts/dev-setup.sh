#!/usr/bin/env bash
# One-command dev environment: fresh clone/worktree → working dashboard + seeded brain.
#
#   ./scripts/dev-setup.sh           → real env from Fly + schema + seed
#   ./scripts/dev-setup.sh --example → skip the Fly pull, use .env.example placeholders
#   ./scripts/dev-setup.sh --prod-db → DATABASE_URL = read-only prod role (test against real data;
#                                      writes only via the local worktree DB, see README)
#   ./scripts/dev-teardown.sh        → remove this checkout's env files
#
# One machine-global local Supabase stack serves EVERYTHING — auth, storage AND the app
# Postgres (:54322). There is no per-worktree database: parallel worktrees share the same
# dev data and schema by design, and `supabase stop` stops it for the whole machine.
# Auth users live in the stack's own `postgres` database and never join app tables.
set -euo pipefail
cd "$(dirname "$0")/.."

ARG="${1:-}"
DB_URL="postgres://postgres:postgres@127.0.0.1:54322/madcactus"
# Container name comes from the committed supabase/config.toml project id (machine-global).
# ponytail: if the project id ever changes, this is the one line to update.
SB_DB=supabase_db_aspectrr-client-dashboard
sql() { docker exec -i "$SB_DB" psql -U postgres -d madcactus -tA "$@"; }

if [[ "$ARG" == "--example" ]]; then
	[ -f dashboard/.env ] || { cp dashboard/.env.example dashboard/.env; echo "→ created dashboard/.env from example (integrations off until keys added)"; }
else
	# --prod-db passes through; otherwise pull-env writes DATABASE_URL = shared dev DB above.
	DEV_DATABASE_URL="$DB_URL" ./scripts/pull-env.sh "$ARG"
fi

echo "→ local Supabase stack (auth+storage :54321, Postgres :54322, Studio :54323)"
supabase start >/dev/null
docker inspect "$SB_DB" >/dev/null 2>&1 || { echo "container $SB_DB not found — did supabase/config.toml's project id change?"; exit 1; }
until docker exec "$SB_DB" pg_isready -U postgres -q 2>/dev/null; do sleep 1; done
# The stack ships one `postgres` database — give the app its own.
docker exec "$SB_DB" psql -U postgres -tA -c "SELECT 1 FROM pg_database WHERE datname = 'madcactus'" | grep -q 1 ||
	docker exec "$SB_DB" psql -U postgres -c 'CREATE DATABASE madcactus' >/dev/null
sql -c 'create extension if not exists vector' >/dev/null 2>&1 || true

# Fresh-looking database? Prefer a real prod snapshot over the synthetic seed — real
# emails/docs/brain facts make local testing meaningful. Snapshot cache is shared and
# refreshed at most daily (REFRESH_PROD=1 forces it). pg_cron/pg_net/vault extensions
# don't exist locally — pg_restore reports those errors and continues; all else lands.
ROWCOUNT=$(sql -c 'select count(*) from companies;' 2>/dev/null || echo 0)
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
			# on POSIX). Wait ≤60s for a concurrent setup run, then proceed unlocked:
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
			echo "→ restoring prod snapshot into the shared dev DB (:54322)"
			RESTORE_ERR=$(mktemp)
			docker exec -i "$SB_DB" pg_restore -U postgres -d madcactus --no-owner --no-privileges <"$CACHE_DIR/prod.dump" 2>"$RESTORE_ERR" || true
			grep -c error "$RESTORE_ERR" >/dev/null 2>&1 && echo "   ($(grep -c 'error:' "$RESTORE_ERR" || true) restore errors — extension-only, expected)"
			rm -f "$RESTORE_ERR"
		fi
	fi
fi

cd dashboard
[ -d node_modules ] || { echo "→ bun install"; bun install; }

ROWCOUNT=$(sql -c 'select count(*) from companies;' 2>/dev/null || echo 0)
if [[ "${ROWCOUNT// /}" -gt 0 ]]; then
	# Apply only the migration files prod doesn't know yet (this branch's pending
	# ones) — the same replay the Supabase GH integration does in prod. Never a
	# blind db:push on a restored DB: prod has schema.ts-foreign columns (brain
	# embeddings) that a schema.ts diff would DROP.
	APPLIED=$(sql -c 'select version from supabase_migrations.schema_migrations' 2>/dev/null || true)
	for f in ../supabase/migrations/[0-9]*.sql; do
		v=$(basename "$f" | cut -d_ -f1)
		if ! grep -qx "$v" <<<"$APPLIED"; then
			echo "→ migration: $(basename "$f")"
			sql -v ON_ERROR_STOP=1 -f - <"$f" || { echo "migration failed: $f"; exit 1; }
		fi
	done
	echo "→ schema = prod snapshot + pending migrations"
else
	# Fresh build: schema.ts is the truth and the DB is empty — push only creates.
	echo "→ schema push"
	DATABASE_URL="$DB_URL" bun run db:push --force
fi

# Seed only when empty — seed.sql is not idempotent.
ROWCOUNT=$(sql -c 'select count(*) from companies;' 2>/dev/null || echo 0)
if [[ "${ROWCOUNT// /}" -gt 0 ]]; then
	echo "→ seed: database already has data, skipping"
else
	echo "→ seeding (corpus + portal users)"
	docker exec -i "$SB_DB" psql -U postgres -d madcactus -v ON_ERROR_STOP=1 < ../supabase/seed.sql
	docker exec -i "$SB_DB" psql -U postgres -d madcactus -v ON_ERROR_STOP=1 < ../supabase/seed-portal.sql
fi
cd ..

STATUS=$(supabase status -o json 2>/dev/null)
API_URL=$(echo "$STATUS" | grep -o '"API_URL": "[^"]*"' | cut -d'"' -f4)
ANON=$(echo "$STATUS" | grep -o '"ANON_KEY": "[^"]*"' | cut -d'"' -f4)
SVC=$(echo "$STATUS" | grep -o '"SERVICE_ROLE_KEY": "[^"]*"' | cut -d'"' -f4)
if [ -n "$API_URL" ] && [ -n "$ANON" ] && [ -n "$SVC" ] && [ ! -f dashboard/.env.local ]; then
	cat > dashboard/.env.local <<LOCAL
# Local Supabase overrides (dev only) — written by scripts/dev-setup.sh.
# dashboard/.env DATABASE_URL already points at this stack's Postgres (:54322).
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

cat <<TIP

Dev environment ready (DATABASE_URL → shared stack Postgres :54322).
  cd dashboard && bun run dev   → http://localhost:3000/admin   (login: admin@madcactus.org / cactus-local-dev)
  Supabase Studio               → http://localhost:54323        (storage, auth users, table editor)

dashboard/.env holds the REAL prod keys (Gmail OAuth, Slack, LLM, Resend…).
Override anything by editing it — pull-env backs up your edits to .env.bak
before the next pull. Parallel worktrees share this stack's data by design.
TIP
