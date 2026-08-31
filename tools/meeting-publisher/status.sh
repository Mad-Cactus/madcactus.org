#!/bin/bash
# Health check for the meeting-publisher launchd job.
#
#   ./status.sh          — daemon state + recent log + failures
#   ./status.sh --scan   — also query the dashboard: which meetings would push
set -u
HOME_DIR="$HOME/.madcactus/meeting-publisher"
STATE="$HOME_DIR/state"
LABEL="com.madcactus.meeting-publisher"
BUN="$(command -v bun || echo "$HOME/.bun/bin/bun")"

echo "── launchd job ─────────────────────────────────────────────"
if launchctl print "gui/$(id -u)/$LABEL" >/tmp/mc-status.$$ 2>&1; then
	state=$(grep -m1 "state =" /tmp/mc-status.$$ | awk -F'= ' '{print $2}')
	lastexit=$(grep -m1 "last exit code =" /tmp/mc-status.$$ | awk -F'= ' '{print $2}')
	pid=$(grep -m1 "pid =" /tmp/mc-status.$$ | awk -F'= ' '{print $2}')
	echo "loaded: yes | state: ${state:-?} | pid: ${pid:-—} | last exit: ${lastexit:-—}"
else
	echo "loaded: NO — run install.sh to bootstrap it"
fi
rm -f /tmp/mc-status.$$

if [ ! -f "$STATE/pushed.txt" ]; then
	echo "state: not installed at $HOME_DIR (run install.sh)"
	exit 0
fi

echo
echo "── stats ───────────────────────────────────────────────────"
echo "pushed:  $(grep -c . "$STATE/pushed.txt" 2>/dev/null || echo 0) meetings"
[ -f "$STATE/failed.log" ] && echo "FAILED:  $(grep -c . "$STATE/failed.log") — $(tail -1 "$STATE/failed.log")"

echo
echo "── last activity (state/log) ───────────────────────────────"
tail -5 "$STATE/log" 2>/dev/null || echo "(no activity yet — first push pending)"

if [ "${1:-}" = "--scan" ]; then
	echo
	echo "── eligible right now (--scan) ─────────────────────────────"
	"$BUN" "$HOME_DIR/publish.ts" --scan
fi
