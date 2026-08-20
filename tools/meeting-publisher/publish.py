#!/usr/bin/env python3
"""Anarlog → Mad Cactus meeting publisher (pure code, no agent).

Single pass, meant to run every 60s via launchd (StartInterval). For each
finished meeting session in Anarlog's local app.db that hasn't been pushed:

  words_json → utterances (split on speaker-channel change or >1500ms pause,
  mirroring meetings-cli) → speaker blocks (merge consecutive same-channel
  utterances, ≤5s gap, ≤400 words) → POST draft to the dashboard with audio.

Transcripts land verbatim with speaker labels — redaction/edits happen by the
human in /admin/meetings. State in ./state/ next to this script.
"""

import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import urllib.request
from datetime import datetime, timezone

HOME_DIR = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HOME_DIR, "state")
DB = os.path.expanduser("~/Library/Application Support/hyprnote/app.db")
API_KEY = os.environ.get("MADCACTUS_API_KEY", "")
BASE_URL = os.environ.get("MADCACTUS_URL", "https://app.madcactus.org")
UPLOAD_URL = f"{BASE_URL}/api/upload-transcript"
MAX_ATTEMPTS = 3

PAUSE_MS = 1500          # utterance split: silence gap (matches meetings-cli)
MERGE_GAP_MS = 5000      # merge consecutive same-speaker utterances into a block
MAX_BLOCK_WORDS = 400
MIN_WORDS = 2000         # sessions with less than this are notes/chitchat, not meetings

os.makedirs(STATE, exist_ok=True)


def log(msg: str) -> None:
    with open(os.path.join(STATE, "log"), "a") as f:
        f.write(f"{datetime.now().isoformat(timespec='seconds')} {msg}\n")


def ready_sessions(db: sqlite3.Connection) -> list[str]:
    """Finished meetings: real transcript, quiet ≥10 min, recent, batch row or
    quiet ≥45 min. julianday() because ISO 'T' timestamps never string-match
    datetime('now')."""
    rows = db.execute(
        """
        SELECT s.id
        FROM sessions s
        JOIN transcripts t ON t.session_id = s.id AND t.deleted_at IS NULL
        GROUP BY s.id
        HAVING MAX(length(t.words_json)) > ?
          AND julianday(MAX(t.updated_at)) < julianday('now', '-10 minutes')
          AND julianday(s.created_at) > julianday('now', '-7 days')
          AND (
            MAX(CASE WHEN t.source = 'batch_transcription' THEN 1 ELSE 0 END) = 1
            OR julianday(MAX(t.updated_at)) < julianday('now', '-45 minutes')
          )
        """
        , (MIN_WORDS,)
    ).fetchall()
    return [r[0] for r in rows]


def load_pushed() -> set[str]:
    path = os.path.join(STATE, "pushed.txt")
    if not os.path.exists(path):
        return set()
    with open(path) as f:
        return {line.strip() for line in f if line.strip()}


def mark_pushed(session_id: str) -> None:
    with open(os.path.join(STATE, "pushed.txt"), "a") as f:
        f.write(session_id + "\n")


def load_attempts() -> dict[str, int]:
    path = os.path.join(STATE, "attempts.tsv")
    counts: dict[str, int] = {}
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                parts = line.rstrip("\n").split("\t")
                if len(parts) >= 2:
                    counts[parts[0]] = int(parts[1])
    return counts


def bump_attempt(session_id: str, n: int) -> None:
    counts = load_attempts()
    counts[session_id] = n
    with open(os.path.join(STATE, "attempts.tsv"), "w") as f:
        for sid, c in counts.items():
            f.write(f"{sid}\t{c}\n")


def build_blocks(words: list[dict]) -> list[dict]:
    """words → utterances (channel/pause split) → merged speaker blocks."""
    if not words:
        return []

    # ── utterances: split on channel change or gap > PAUSE_MS ──
    utterances = []  # {channel, start_ms, end_ms, text}
    cur = [words[0]]
    for w in words[1:]:
        prev = cur[-1]
        gap = w["start_ms"] - prev["end_ms"]
        if w["channel"] != prev["channel"] or gap > PAUSE_MS:
            utterances.append(cur)
            cur = [w]
        else:
            cur.append(w)
    utterances.append(cur)

    # ── blocks: merge consecutive same-channel utterances ──
    blocks = []
    for chunk in utterances:
        text = re.sub(r"\s+", " ", "".join(w["text"] for w in chunk)).strip()
        if not text:
            continue
        utt = {
            "channel": chunk[0]["channel"],
            "start_ms": chunk[0]["start_ms"],
            "end_ms": chunk[-1]["end_ms"],
            "text": text,
        }
        last = blocks[-1] if blocks else None
        if (
            last
            and last["channel"] == utt["channel"]
            and utt["start_ms"] - last["end_ms"] <= MERGE_GAP_MS
            and len(last["text"].split()) + len(text.split()) <= MAX_BLOCK_WORDS
        ):
            last["text"] += " " + text
            last["end_ms"] = utt["end_ms"]
        else:
            blocks.append(utt)

    # speaker labels — same scheme as meetings-cli
    return [
        {"speaker": f"Speaker {b['channel']}", "start_ms": b["start_ms"], "end_ms": b["end_ms"], "text": b["text"]}
        for b in blocks
    ]


def publish(session_id: str) -> str | None:
    """Push one session. Returns error string, or None on success."""
    if not API_KEY:
        return "MADCACTUS_API_KEY not set"

    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    row = db.execute(
        "SELECT title FROM sessions WHERE id = ?", (session_id,)
    ).fetchone()
    if not row:
        return "session not found"
    title = row[0] or "Untitled Meeting"

    # final transcript row: batch beats live; latest wins within each
    trow = db.execute(
        """
        SELECT words_json, started_at_ms FROM transcripts
        WHERE session_id = ? AND deleted_at IS NULL AND words_json IS NOT NULL
        ORDER BY CASE source WHEN 'batch_transcription' THEN 0 ELSE 1 END,
                 updated_at DESC LIMIT 1
        """,
        (session_id,),
    ).fetchone()
    if not trow:
        return "no transcript"
    words = json.loads(trow[0])

    audio = os.path.expanduser(f"~/Library/Application Support/hyprnote/sessions/{session_id}/audio.mp3")
    if not os.path.exists(audio):
        # no recording on disk → typed note, not a meeting; push nothing
        mark_pushed(session_id)
        log(f"{session_id} skipped (no audio file — not a recorded meeting)")
        return None

    blocks = build_blocks(words)
    if not blocks:
        return "no speakable blocks"

    started = datetime.fromtimestamp(trow[1] / 1000, tz=timezone.utc)
    full_title = f"{title} — {started.strftime('%b %-d')}"
    content = "\n\n".join(f"{b['speaker']}: {b['text']}" for b in blocks)

    with tempfile.TemporaryDirectory() as tmp:
        blocks_path = os.path.join(tmp, "blocks.json")
        content_path = os.path.join(tmp, "content.txt")
        with open(blocks_path, "w") as f:
            json.dump(blocks, f)
        with open(content_path, "w") as f:
            f.write(content)

        # curl for multipart — a ~100MB audio file is not worth urllib surgery
        cmd = [
            "curl", "-sS", "-X", "POST", UPLOAD_URL,
            "-H", f"Authorization: Bearer {API_KEY}",
            "-w", "\n%{http_code}",
            "-F", "visibility=draft",
            "-F", f"title={full_title}",
            "-F", f"content=<{content_path}",
            "-F", f"transcript_json=<{blocks_path}",
            "-F", f"audio=@{audio};type=audio/mpeg",
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    body, _, code = proc.stdout.rpartition("\n")

    if code == "201" and '"ok":true' in body.replace(" ", ""):
        return None
    return f"upload failed: http={code} {body[:200]} {proc.stderr[:200]}".strip()


def main() -> None:
    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    pushed = load_pushed()
    attempts = load_attempts()

    for sid in ready_sessions(db):
        if sid in pushed:
            continue
        n = attempts.get(sid, 0)
        if n >= MAX_ATTEMPTS:
            with open(os.path.join(STATE, "failed.log"), "a") as f:
                f.write(f"{datetime.now().isoformat(timespec='seconds')} {sid} gave up after {MAX_ATTEMPTS} attempts\n")
            continue

        bump_attempt(sid, n + 1)
        log(f"{sid} pushing (attempt {n + 1})")
        err = publish(sid)
        if err is None:
            mark_pushed(sid)
            log(f"{sid} pushed")
        else:
            log(f"{sid} ERROR: {err}")


if __name__ == "__main__":
    sys.exit(main())
