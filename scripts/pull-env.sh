#!/usr/bin/env bash
# dashboard/.env = real prod secrets, cached in the macOS Keychain (this user, this
# machine) after a one-time pull from the Fly machine. All worktrees read the
# Keychain copy — NO Fly token exists locally, so nothing here can deploy or touch
# Fly at all. Deploys happen only via GitHub Actions on merge to main.
#
#   ./scripts/pull-env.sh             → build dashboard/.env from the Keychain cache
#   ./scripts/pull-env.sh --refresh   → re-pull from the Fly machine (needs `flyctl auth login`;
#                                       do this when you change secrets on Fly)
#   ./scripts/pull-env.sh --prod-db   → DATABASE_URL = read-only prod role (see README)
#
# Why not a scoped Fly token: tested 2026-09 — ssh/machine-exec scoped tokens fail
# `fly ssh console`/`machine exec` ("unauthorized"/"token validation error"); Fly
# scoped tokens can't drive the CLI's exec flows, and the org token would grant
# deploy. Keychain caching needs no Fly access at all.
set -euo pipefail
cd "$(dirname "$0")/.."
APP="${FLY_APP:-madcactus-dashboard}"
KC_SERVICE="madcactus-dashboard-env"
ARG="${1:-}"

if [[ "$ARG" == "--refresh" ]]; then
	command -v flyctl >/dev/null || { echo "flyctl missing: brew install flyctl && flyctl auth login"; exit 1; }
	RAW=$(mktemp); trap 'rm -f "$RAW"' EXIT
	# Wake the machine via public URL (autostart) before ssh.
	curl -sf -m 90 "https://$APP.fly.dev/admin/login" >/dev/null 2>&1 || true
	if ! flyctl ssh console -C "env" -a "$APP" >"$RAW" 2>/dev/null; then
		sleep 8
		flyctl ssh console -C "env" -a "$APP" >"$RAW" 2>/dev/null \
			|| { echo "flyctl ssh failed — run: flyctl auth login"; exit 1; }
	fi
	grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$RAW" \
		| awk '$0 !~ /^(FLY_[A-Z_]*|PATH|HOME|SHELL|USER|TMPDIR|NODE_ENV|PORT|HOST|TERM)=/' > "$RAW.clean"
	grep -q '^SUPABASE_URL=' "$RAW.clean" || { echo "no SUPABASE_URL in machine output — flyctl auth or app name wrong?"; exit 1; }
	security add-generic-password -s "$KC_SERVICE" -a "$USER" -U -w "$(base64 < "$RAW.clean")"
	echo "→ Keychain cache refreshed ($KC_SERVICE)"
fi

SRC=$(security find-generic-password -s "$KC_SERVICE" -w 2>/dev/null | base64 -d 2>/dev/null || true)
if [[ -z "$SRC" ]]; then
	echo "no cached env yet — one-time setup:"
	echo "  flyctl auth login"
	echo "  ./scripts/pull-env.sh --refresh"
	echo "(then optionally: flyctl auth logout — nothing local needs Fly afterwards)"
	exit 1
fi

# Hand-maintained vars survive re-pulls.
RO_URL=$(grep -h '^PROD_RO_DB_URL=' dashboard/.env 2>/dev/null | tail -1 | cut -d= -f2- || true)

# Back up any hand-edited .env (pull-env overwrites it).
[ -f dashboard/.env ] && cp dashboard/.env dashboard/.env.bak

# Cache content first, but WITHOUT keys we override; overrides are appended LAST.
# (bun dotenv: last definition wins; vite: first wins — dedupe makes both correct.)
OVERRIDDEN='^(PUBLIC_SITE_URL|DATABASE_URL)='
printf '%s\n' "$SRC" | awk -v ov="$OVERRIDDEN" '$0 !~ ov' > dashboard/.env
{
	echo "# ── local overrides (scripts/pull-env.sh; delete this file to re-pull) ──"
	echo "PUBLIC_SITE_URL=http://localhost:3000  # OAuth redirects → allowlisted localhost URI"
	if [[ "$ARG" == "--prod-db" ]]; then
		echo "# Read-only PROD database (testing against real data — writes fail at Postgres level):"
		echo "DATABASE_URL=${RO_URL:-${DEV_DATABASE_URL:-postgres://postgres:postgres@localhost:5434/madcactus}}"
	else
		echo "DATABASE_URL=${DEV_DATABASE_URL:-postgres://postgres:postgres@localhost:5434/madcactus}"
	fi
	echo "# Dev-only portal logins are not in prod env — see supabase/seed-portal.sql + seed.sql"
} >> dashboard/.env
grep -q '^SUPABASE_URL=' dashboard/.env || { echo "cached env missing SUPABASE_URL — re-run --refresh"; exit 1; }
echo "→ dashboard/.env ready: $(grep -cE '^[A-Za-z_]' dashboard/.env) vars (overrides + Keychain cache)"
