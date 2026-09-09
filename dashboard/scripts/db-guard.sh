#!/usr/bin/env bash
# Guard for drizzle-kit push/migrate: they write schema straight to DATABASE_URL.
# Local Docker Postgres only — prod migrations ship via the Supabase GitHub
# integration (AGENTS.md). Pushing against prod desyncs migration history.
set -euo pipefail
CMD="$1"; shift

allow() { exec bunx drizzle-kit "$CMD" "$@"; }

[[ "${ALLOW_REMOTE:-}" == "1" ]] && allow
case "${DATABASE_URL:-}" in
	*localhost*|*127.0.0.1*|*@db:*) allow ;;
	*)
		echo "REFUSING db:$CMD — DATABASE_URL is not a local host." >&2
		echo "Prod schema changes go through migrations + the Supabase GH integration." >&2
		echo "Really want a remote dev DB: ALLOW_REMOTE=1 bun run db:$CMD" >&2
		exit 1 ;;
esac
