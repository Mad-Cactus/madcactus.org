#!/usr/bin/env bash
# Compress a video under the Supabase free-plan 50MB upload cap — the native-ffmpeg
# twin of the in-browser path in dashboard/src/routes/admin/videos.tsx.
#
#   scripts/compress-video.sh recording.mov [output.mp4]
#
# Exits 1 (keeping the output) if it's still ≥49MB after the crf-32 retry —
# trim the recording or split it instead.
set -euo pipefail

IN=${1:?usage: compress-video.sh <input> [output.mp4]}
OUT=${2:-${IN%.*}-small.mp4}
size() { stat -f%z "$1" 2>/dev/null || stat -c%s "$1"; }

command -v ffmpeg >/dev/null || { echo "ffmpeg not found — brew install ffmpeg"; exit 1; }
[ -f "$IN" ] || { echo "no such file: $IN"; exit 1; }

CRF=28
for pass in 1 2; do
	echo "→ pass $pass (crf $CRF) → $OUT"
	ffmpeg -y -hide_banner -loglevel error -i "$IN" \
		-vf "scale='min(1920,iw)':-2" -c:v libx264 -preset ultrafast -crf "$CRF" \
		-c:a aac -b:a 96k -movflags +faststart "$OUT"
	(( $(size "$OUT") < 49 * 1024 * 1024 )) && break
	CRF=32
done

BYTES=$(size "$OUT")
if (( BYTES >= 49 * 1024 * 1024 )); then
	echo "still $((BYTES / 1024 / 1024))MB after crf 32 — trim the recording or split it"
	exit 1
fi
echo "→ $OUT ($((BYTES / 1024 / 1024))MB)"
