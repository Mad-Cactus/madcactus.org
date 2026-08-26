#!/usr/bin/env bun
/** Anarlog → Mad Cactus meeting publisher (pure Bun/TS, no agent).
 *
 * One pass per invocation (launchd runs it every 60s). For each finished
 * meeting in Anarlog's local app.db that (a) matches the filter config and
 * (b) hasn't been pushed: words_json → speaker blocks → POST draft + audio.
 *
 * Filtering is DEFAULT-DENY: config.json (next to this script) lists
 * titlePatterns / participantPatterns; a session pushes only if one matches.
 * Anarlog has no user-facing tags feature (verified: no UI, no docs, no CLI),
 * so titles — which you already name by client — are the reliable signal.
 *
 * `bun publish.ts --scan` lists ready sessions and which pattern matched.
 */

import { Database } from "bun:sqlite";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HOME_DIR = import.meta.dir;
const STATE = join(HOME_DIR, "state");
const DB_PATH = `${process.env.HOME}/Library/Application Support/hyprnote/app.db`;
const API_KEY = process.env.MADCACTUS_API_KEY ?? "";
const BASE_URL = process.env.MADCACTUS_URL ?? "https://app.madcactus.org";
const UPLOAD_URL = `${BASE_URL}/api/upload-transcript`;
const MAX_ATTEMPTS = 3;

const PAUSE_MS = 1500; // utterance split: silence gap (matches meetings-cli)
const MERGE_GAP_MS = 5000; // merge consecutive same-speaker utterances
const MAX_BLOCK_WORDS = 400;
const MIN_WORDS = 2000; // less than this = note/chitchat, not a meeting

interface Word {
	text: string;
	start_ms: number;
	end_ms: number;
	channel: number;
}
interface Block {
	speaker: string;
	start_ms: number;
	end_ms: number;
	text: string;
}
interface Config {
	titlePatterns: string[];
	participantPatterns: string[];
}

mkdirSync(STATE, { recursive: true });

function log(msg: string): void {
	appendFileSync(
		join(STATE, "log"),
		`${new Date().toISOString().slice(0, 19)} ${msg}\n`,
	);
}

function loadConfig(): Config {
	const path = join(HOME_DIR, "config.json");
	if (!existsSync(path)) return { titlePatterns: [], participantPatterns: [] };
	try {
		const cfg = JSON.parse(readFileSync(path, "utf8")) as Partial<Config>;
		return {
			titlePatterns: Array.isArray(cfg.titlePatterns) ? cfg.titlePatterns.map(String) : [],
			participantPatterns: Array.isArray(cfg.participantPatterns) ? cfg.participantPatterns.map(String) : [],
		};
	} catch (e) {
		log(`config.json unreadable: ${e} — pushing nothing until fixed`);
		return { titlePatterns: [], participantPatterns: [] };
	}
}

/** Which pattern matched (case-insensitive substring), or null = don't push. */
function matchConfig(cfg: Config, title: string, participants: string[]): string | null {
	for (const p of cfg.titlePatterns) {
		if (p && title.toLowerCase().includes(p.toLowerCase())) return `title~"${p}"`;
	}
	for (const p of cfg.participantPatterns) {
		for (const who of participants) {
			if (p && who.toLowerCase().includes(p.toLowerCase())) return `participant~"${p}"`;
		}
	}
	return null;
}

// Finished meetings: real transcript, quiet ≥10 min, recent, batch row or
// quiet ≥45 min. julianday() because ISO 'T' timestamps never string-match
// datetime('now').
const READY_SQL = `
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
		)`;

function readySessions(db: Database): string[] {
	return (db.query(READY_SQL).all(MIN_WORDS) as { id: string }[]).map((r) => r.id);
}

function sessionMeta(db: Database, id: string): { title: string; participants: string[] } {
	const [row] = db
		.query("SELECT title FROM sessions WHERE id = ?")
		.all(id) as { title: string }[];
	const parts = db
		.query(
			`SELECT DISTINCT COALESCE(NULLIF(h.name, ''), NULLIF(sp.display_name, '')) AS name
			 FROM session_participants sp LEFT JOIN humans h ON h.id = sp.human_id
			 WHERE sp.session_id = ? AND sp.deleted_at IS NULL`,
		)
		.all(id) as { name: string | null }[];
	return {
		title: row?.title ?? "Untitled Meeting",
		participants: parts.map((p) => p.name).filter((n): n is string => !!n),
	};
}

function loadPushed(): Set<string> {
	const path = join(STATE, "pushed.txt");
	if (!existsSync(path)) return new Set();
	return new Set(
		readFileSync(path, "utf8")
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean),
	);
}

function markPushed(id: string): void {
	appendFileSync(join(STATE, "pushed.txt"), id + "\n");
}

function loadAttempts(): Map<string, number> {
	const path = join(STATE, "attempts.tsv");
	const counts = new Map<string, number>();
	if (existsSync(path)) {
		for (const line of readFileSync(path, "utf8").split("\n")) {
			const [sid, n] = line.split("\t");
			if (sid && n) counts.set(sid, Number(n));
		}
	}
	return counts;
}

function saveAttempts(counts: Map<string, number>): void {
	writeFileSync(
		join(STATE, "attempts.tsv"),
		[...counts.entries()].map(([sid, n]) => `${sid}\t${n}`).join("\n") + "\n",
	);
}

/** words → utterances (channel/pause split) → merged speaker blocks.
 *  Mirrors meetings-cli's utterance algorithm; labels are `Speaker N`. */
function buildBlocks(words: Word[]): Block[] {
	if (words.length === 0) return [];

	// ── utterances: split on channel change or gap > PAUSE_MS ──
	const utterances: Word[][] = [[words[0]]];
	for (const w of words.slice(1)) {
		const cur = utterances[utterances.length - 1];
		const prev = cur[cur.length - 1];
		if (w.channel !== prev.channel || w.start_ms - prev.end_ms > PAUSE_MS) {
			utterances.push([w]);
		} else {
			cur.push(w);
		}
	}

	// ── blocks: merge consecutive same-channel utterances ──
	interface MutableBlock {
		channel: number;
		start_ms: number;
		end_ms: number;
		text: string;
	}
	const blocks: MutableBlock[] = [];
	for (const chunk of utterances) {
		const text = chunk.map((w) => w.text).join("").replace(/\s+/g, " ").trim();
		if (!text) continue;
		const utt = {
			channel: chunk[0].channel,
			start_ms: chunk[0].start_ms,
			end_ms: chunk[chunk.length - 1].end_ms,
			text,
		};
		const last = blocks[blocks.length - 1];
		if (
			last &&
			last.channel === utt.channel &&
			utt.start_ms - last.end_ms <= MERGE_GAP_MS &&
			last.text.split(" ").length + text.split(" ").length <= MAX_BLOCK_WORDS
		) {
			last.text += " " + text;
			last.end_ms = utt.end_ms;
		} else {
			blocks.push(utt);
		}
	}
	return blocks.map((b) => ({
		speaker: `Speaker ${b.channel}`,
		start_ms: b.start_ms,
		end_ms: b.end_ms,
		text: b.text,
	}));
}

/** Push one session. Returns error string, or null on success. */
async function publish(db: Database, sessionId: string): Promise<string | null> {
	if (!API_KEY) return "MADCACTUS_API_KEY not set";

	const { title } = sessionMeta(db, sessionId);

	// final transcript row: batch beats live; latest wins within each
	const [trow] = db
		.query(
			`SELECT words_json, started_at_ms FROM transcripts
			 WHERE session_id = ? AND deleted_at IS NULL AND words_json IS NOT NULL
			 ORDER BY CASE source WHEN 'batch_transcription' THEN 0 ELSE 1 END,
					updated_at DESC LIMIT 1`,
		)
		.all(sessionId) as { words_json: string; started_at_ms: number }[];
	if (!trow) return "no transcript";
	const words = JSON.parse(trow.words_json) as Word[];

	const audio = `${process.env.HOME}/Library/Application Support/hyprnote/sessions/${sessionId}/audio.mp3`;
	if (!existsSync(audio)) {
		// no recording on disk → typed note, not a meeting; push nothing
		markPushed(sessionId);
		log(`${sessionId} skipped (no audio file — not a recorded meeting)`);
		return null;
	}

	const blocks = buildBlocks(words);
	if (blocks.length === 0) return "no speakable blocks";

	const started = new Date(trow.started_at_ms);
	const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	const fullTitle = `${title} — ${months[started.getUTCMonth()]} ${started.getUTCDate()}`;
	const content = blocks.map((b) => `${b.speaker}: ${b.text}`).join("\n\n");

	const form = new FormData();
	form.set("visibility", "draft");
	form.set("title", fullTitle);
	form.set("content", content);
	form.set("transcript_json", JSON.stringify(blocks));
	form.append("audio", new Blob([Bun.file(audio)], { type: "audio/mpeg" }), "audio.mp3");

	let res: Response;
	try {
		res = await fetch(UPLOAD_URL, {
			method: "POST",
			headers: { Authorization: `Bearer ${API_KEY}` },
			body: form,
			signal: AbortSignal.timeout(30 * 60_000),
		});
	} catch (e) {
		return `upload failed: ${e}`;
	}
	let body: unknown = null;
	try {
		body = await res.json();
	} catch {
		/* non-JSON body */
	}
	if (res.status === 201 && !!body && (body as { ok?: boolean }).ok === true) {
		return null;
	}
	return `upload failed: http=${res.status} ${JSON.stringify(body)?.slice(0, 200)}`;
}

function scan(db: Database): void {
	const cfg = loadConfig();
	const pushed = loadPushed();
	console.log(`config: titlePatterns=${JSON.stringify(cfg.titlePatterns)} participantPatterns=${JSON.stringify(cfg.participantPatterns)}`);
	for (const sid of readySessions(db)) {
		const { title, participants } = sessionMeta(db, sid);
		const matched = matchConfig(cfg, title, participants);
		console.log(
			`${matched ? "PUSH" : "skip"}  ${title}  [${participants.join(", ") || "no participants"}]${matched ? ` (${matched})` : ""}${pushed.has(sid) ? " (already pushed)" : ""}`,
		);
	}
}

async function main(): Promise<number> {
	const db = new Database(DB_PATH, { readonly: true, create: false });

	if (process.argv.includes("--scan")) {
		scan(db);
		return 0;
	}

	const cfg = loadConfig();
	const pushed = loadPushed();
	const attempts = loadAttempts();

	for (const sid of readySessions(db)) {
		if (pushed.has(sid)) continue;
		const { title, participants } = sessionMeta(db, sid);
		const matched = matchConfig(cfg, title, participants);
		if (!matched) continue; // default-deny: not a configured meeting type

		const n = attempts.get(sid) ?? 0;
		if (n >= MAX_ATTEMPTS) {
			appendFileSync(
				join(STATE, "failed.log"),
				`${new Date().toISOString().slice(0, 19)} ${sid} gave up after ${MAX_ATTEMPTS} attempts\n`,
			);
			continue;
		}

		attempts.set(sid, n + 1);
		saveAttempts(attempts);
		log(`${sid} pushing "${title}" ${matched} (attempt ${n + 1})`);
		const err = await publish(db, sid);
		if (err === null) {
			markPushed(sid);
			log(`${sid} pushed`);
		} else {
			log(`${sid} ERROR: ${err}`);
		}
	}
	return 0;
}

process.exit(await main());
