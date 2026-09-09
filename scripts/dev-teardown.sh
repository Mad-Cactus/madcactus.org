#!/usr/bin/env bash
# Undo everything dev-setup.sh created for this workspace:
#   ./scripts/dev-teardown.sh                → stop + remove compose stack, DELETE its data volume, remove dashboard/.env
#   ./scripts/dev-teardown.sh --keep-env     → keep dashboard/.env (keys you added)
#
# node_modules is kept (rm -rf dashboard/node_modules yourself if you want it gone).
set -euo pipefail
cd "$(dirname "$0")/.."

# Same compose selection as dev-setup.sh: main checkout = docker-compose.yml, others = worktree file.
DIR=$(basename "$PWD")
if [[ "$DIR" == "madcactus.org" ]]; then COMPOSE=(docker compose); else COMPOSE=(docker compose -f docker-compose.worktree.yml); fi

echo "→ stopping compose stack and removing its data volume"
"${COMPOSE[@]}" --profile app down -v --remove-orphans

if [[ "${1:-}" != "--keep-env" && -f dashboard/.env ]]; then
	rm dashboard/.env
	echo "→ removed dashboard/.env"
fi

echo "Dev environment removed. Re-create anytime: ./scripts/dev-setup.sh"
