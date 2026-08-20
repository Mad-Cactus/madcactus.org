#!/bin/bash
# Install the Anarlog → Mad Cactus meeting publisher on this Mac.
#
#   ./install.sh <mc_api_key> [dashboard_url]
#
# 1. Seeds the pushed-state with every session already in Anarlog so the
#    daemon only picks up meetings recorded from now on.
# 2. Copies publish.py to ~/.madcactus/meeting-publisher (stable home — the
#    job must not run out of a repo worktree that can disappear).
# 3. Renders the launchd plist (cron-style, one pass per minute) and loads it.
set -euo pipefail

API_KEY="${1:?usage: ./install.sh <mc_api_key> [dashboard_url]}"
URL="${2:-https://app.madcactus.org}"
HERE="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="$HOME/.madcactus/meeting-publisher"
STATE="$HOME_DIR/state"
DB="$HOME/Library/Application Support/hyprnote/app.db"
LABEL="com.madcactus.meeting-publisher"

mkdir -p "$STATE"
cp "$HERE/publish.py" "$HOME_DIR/publish.py"
touch "$STATE/pushed.txt"

# Seed: mark all existing sessions as pushed (idempotent re-install)
count=0
while IFS= read -r id; do
	[ -n "$id" ] || continue
	grep -q "^$id\$" "$STATE/pushed.txt" || { echo "$id" >> "$STATE/pushed.txt"; count=$((count + 1)); }
done < <(sqlite3 "file:$DB?mode=ro" "SELECT id FROM sessions;" 2>/dev/null)
echo "Seeded $count existing sessions as already-handled."

# Render + install the plist
sed -e "s|__API_KEY__|$API_KEY|g" -e "s|__URL__|$URL|g" -e "s|__HOME__|$HOME_DIR|g" \
	"$HERE/$LABEL.plist.template" > "$HOME_DIR/$LABEL.plist"

launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/$LABEL.plist" 2>/dev/null || true
mkdir -p "$HOME/Library/LaunchAgents"
cp "$HOME_DIR/$LABEL.plist" "$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/$LABEL.plist"

echo "Installed + started. Logs: $STATE/log  (drafts appear at $URL/admin/meetings)"
