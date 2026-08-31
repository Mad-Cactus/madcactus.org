#!/bin/bash
# Install the Anarlog → Mad Cactus meeting publisher on this Mac.
#
#   ./install.sh <mc_api_key> [dashboard_url]
#
# 1. Copies publish.ts + config to ~/.madcactus/meeting-publisher (stable
#    home — the job must not run out of a repo worktree that can disappear).
# 2. Seeds the pushed-state with every session already in Anarlog so only
#    meetings recorded from now on are candidates.
# 3. Renders the launchd plist (cron-style, one pass per minute) and loads it.
#
# Which meetings push is configured in the dashboard: each company page has a
# "Meeting pseudonyms" field. A meeting pushes when its Anarlog title contains
# a client's name or pseudonym. Test with:
#   ~/.bun/bin/bun ~/.madcactus/meeting-publisher/publish.ts --scan
set -euo pipefail

API_KEY="${1:?usage: ./install.sh <mc_api_key> [dashboard_url]}"
URL="${2:-https://app.madcactus.org}"
HERE="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="$HOME/.madcactus/meeting-publisher"
STATE="$HOME_DIR/state"
DB="$HOME/Library/Application Support/hyprnote/app.db"
LABEL="com.madcactus.meeting-publisher"
BUN="$(command -v bun || true)"
[ -n "$BUN" ] || { echo "bun not found on PATH — install with: curl -fsSL https://bun.sh/install | bash"; exit 1; }

mkdir -p "$STATE"
cp "$HERE/publish.ts" "$HOME_DIR/publish.ts"
touch "$STATE/pushed.txt"

# Seed: mark all existing sessions as pushed (idempotent re-install)
count=0
while IFS= read -r id; do
	[ -n "$id" ] || continue
	grep -q "^$id\$" "$STATE/pushed.txt" || { echo "$id" >> "$STATE/pushed.txt"; count=$((count + 1)); }
done < <(sqlite3 "file:$DB?mode=ro" "SELECT id FROM sessions;" 2>/dev/null)
echo "Seeded $count existing sessions as already-handled."

# Render + install the plist (absolute bun path — launchd has no shell PATH)
sed -e "s|__API_KEY__|$API_KEY|g" -e "s|__URL__|$URL|g" -e "s|__HOME__|$HOME_DIR|g" -e "s|__BUN__|$BUN|g" \
	"$HERE/$LABEL.plist.template" > "$HOME_DIR/$LABEL.plist"

launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/$LABEL.plist" 2>/dev/null || true
mkdir -p "$HOME/Library/LaunchAgents"
cp "$HOME_DIR/$LABEL.plist" "$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/$LABEL.plist"

echo "Installed + started. Logs: $STATE/log  (drafts appear at $URL/admin/meetings)"
echo "Pseudonyms are edited per client in the dashboard: $URL/admin/companies"
