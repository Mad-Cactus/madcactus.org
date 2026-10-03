#!/usr/bin/env bash
# Undo this checkout's dev setup:
#   ./scripts/dev-teardown.sh            → remove dashboard/.env + dashboard/.env.local
#   ./scripts/dev-teardown.sh --keep-env → keep dashboard/.env (keys you added)
#
# There is no per-checkout database anymore: the local Supabase stack is
# machine-global and shared by every worktree, so teardown does NOT stop it.
# `supabase stop` stops it for the whole machine.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${1:-}" != "--keep-env" && -f dashboard/.env ]]; then
	rm dashboard/.env
	echo "→ removed dashboard/.env"
fi
if [ -f dashboard/.env.local ]; then
	rm dashboard/.env.local
	echo "→ removed dashboard/.env.local"
fi
echo "Dev env files removed. The shared Supabase stack keeps running (supabase stop = machine-wide). Re-create anytime: ./scripts/dev-setup.sh"
