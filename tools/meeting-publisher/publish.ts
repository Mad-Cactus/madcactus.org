#!/usr/bin/env bun
/** Anarlog → Mad Cactus meeting publisher (pure Bun/TS, no agent).
 *
 * One pass per invocation (launchd runs it every 60s). For each finished
 * meeting in Anarlog's local app.db that (a) matches a dashboard client and
 * (b) hasn't been pushed: words_json + memo → speaker blocks → POST draft
 * + audio.
 *
 * Filtering is DEFAULT-DENY, driven by the dashboard: a meeting pushes when
 * its title contains a client's name or one of that client's pseudonyms
 * (aliases are edited on the company page in /admin). Anarlog has no
 * user-facing tags feature (verified: no UI, no docs, no CLI), so titles —
 * which you already name by client — are the reliable signal.
 *
 * `bun publish.ts --scan` lists ready sessions and which client matched.
 */

import { Database } from "bun:sqlite";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const HOME_DIR = import.meta.dir;
const STATE = join(HOME_DIR, "state");
const DB_PATH = `${process.env.HOME}/Library/Application Support/hyprnote/app.db`;
const API_KEY = process.env.MADCACTUS_API_KEY ?? "";
const BASE_URL = process.env.MADCACTUS_URL ?? "https://app.madcactus.org";
const UPLOAD_URL = `${BASE_URL}/api/upload-transcript`;
const CLIENTS_URL = `${BASE_URL}/api/clients`;
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
interface Client {
	name: string;
	aliases: string[];
}

mkdirSync(STATE, { recursive: true });

function log(msg: string): void {
	appendFileSync(
		join(STATE, "log"),
		`${new Date().toISOString().slice(0, 19)} ${msg}\n`,
	);
}

/** Clients + pseudonyms from the dashboard (edited on each company page). */
async function fetchClients(): Promise<Client[] | null> {
	try {
		const res = await fetch(CLIENTS_URL, {
			headers: { Authorization: `Bearer ${API_KEY}` },
			signal: AbortSignal.timeout(30_000),
		});
		const text = await res.text();
		let body: { clients?: Client[] };
		try {
			body = JSON.parse(text);
		} catch {
			throw new Error(`http=${res.status} non-JSON response: ${text.slice(0, 80)}`);
		}
		if (!res.ok) throw new Error(`http=${res.status} ${text.slice(0, 120)}`);
		return body.clients ?? [];
	} catch (e) {
		const msg = `fetching clients from ${CLIENTS_URL} failed: ${e} — pushing nothing this pass`;
		console.error(msg);
		log(msg);
		return null;
	}
}

/** Which client (+ token) the title matches, or null = don't push.
 *  Match: title contains the client name or any pseudonym (case-insensitive). */
function matchClients(title: string, clients: Client[]): { client: Client; via: string } | null {
	const t = title.toLowerCase();
	for (const client of clients) {
		const tokens = [client.name, ...client.aliases].filter(Boolean);
		for (const token of tokens) {
			if (t.includes(token.toLowerCase())) return { client, via: token };
		}
	}
	return null;
}

/** Flatten Anarlog's ProseMirror memo JSON to plain text ("" if absent). */
function memoToText(raw: string | null): string {
	if (!raw) return "";
	try {
		const doc = JSON.parse(raw);
		if (doc?.type !== "doc") return "";
		const walk = (node: any): string => {
			if (node?.type === "text") return node.text ?? "";
			const inner = (node?.content ?? []).map(walk).join("");
			return ["paragraph", "listItem", "heading", "blockquote", "codeBlock"].includes(node?.type)
				? `${inner}\n`
				: inner;
		};
		return walk(doc).replace(/\n{3,}/g, "\n\n").trim();
	} catch {
		return ""; // not JSON → not a memo
	}
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
			`SELECT words_json, started_at_ms, memo FROM transcripts
			 WHERE session_id = ? AND deleted_at IS NULL AND words_json IS NOT NULL
			 ORDER BY CASE source WHEN 'batch_transcription' THEN 0 ELSE 1 END,
					updated_at DESC LIMIT 1`,
		)
		.all(sessionId) as { words_json: string; started_at_ms: number; memo: string | null }[];
	if (!trow) return "no transcript";
	const words = JSON.parse(trow.words_json) as Word[];

	const audio = `${process.env.HOME}/Library/Application Support/hyprnote/sessions/${sessionId}/audio.mp3`;
	if (!existsSync(audio)) {
		// no recording on disk → typed note, not a meeting; push nothing
		markPushed(sessionId);
		log(`${sessionId} skipped (no audio file — not a recorded meeting)`);
		return null;
	}

	// Fly's proxy rejects bodies ≥100MB before the dashboard's own re-encode
	// can run, and 45-90MB uploads stall out mid-flight anyway — so downmix
	// anything over the server's 45MB re-encode threshold to mono AAC sized
	// to land under it (one transcode, not two).
	let audioPath = audio;
	const MAX_BYTES = 45 * 1024 * 1024;
	if (statSync(audio).size > MAX_BYTES) {
		const tmp = `/tmp/${sessionId}-mono.m4a`;
		try {
			const dur = Number(
				execFileSync("ffprobe", [
					"-v", "error", "-show_entries", "format=duration",
					"-of", "csv=p=0", audio,
				]).toString().trim(),
			);
			// fit under 40MB with headroom; floor at 16k so audio stays intelligible
			const bitrate = Math.max(16, Math.min(48, Math.floor((40 * 1024 * 1024 * 8) / dur / 1000)));
			execFileSync("ffmpeg", ["-y", "-i", audio, "-ac", "1", "-b:a", `${bitrate}k`, tmp], {
				stdio: "ignore",
			});
			audioPath = tmp;
			log(`${sessionId} downmixed ${dur.toFixed(0)}s to mono ${bitrate}k (${(statSync(tmp).size / 1048576).toFixed(1)}MB)`);
		} catch (e) {
			return `downmix failed (is ffmpeg installed?): ${e}`;
		}
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
	const memo = memoToText(trow.memo);
	if (memo) form.set("description", memo);
	form.set("content", content);
	form.set("transcript_json", JSON.stringify(blocks));
	form.append("audio", new Blob([Bun.file(audioPath)], { type: "audio/mpeg" }), "audio.mp3");

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

async function scan(db: Database): Promise<void> {
	const clients = await fetchClients();
	if (!clients) {
		console.error("--scan needs a reachable dashboard + MADCACTUS_API_KEY");
		return;
	}
	const pushed = loadPushed();
	console.log(`clients: ${clients.map((c) => `${c.name}(${[c.name, ...c.aliases].join("/")})`).join(", ") || "NONE — nothing will push"}`);
	for (const sid of readySessions(db)) {
		const { title, participants } = sessionMeta(db, sid);
		const matched = matchClients(title, clients);
		console.log(
			`${matched ? "PUSH" : "skip"}  ${title}  [${participants.join(", ") || "no participants"}]${matched ? ` → ${matched.client.name} via "${matched.via}"` : ""}${pushed.has(sid) ? " (already pushed)" : ""}`,
		);
	}
}

/** Readonly when possible. Falls back to read-write (SELECT-only) because a
 *  readonly connection cannot create the WAL -shm file when Anarlog is closed
 *  — SQLITE_CANTOPEN. The fallback does what the sqlite3 CLI does.
 *  bun:sqlite opens lazily: probe with a real query before trusting readonly. */
function openDb(): Database {
	if (!existsSync(DB_PATH)) {
		throw new Error(`Anarlog database not found at ${DB_PATH}`);
	}
	try {
		const db = new Database(DB_PATH, { readonly: true });
		db.query("SELECT 1").get();
		return db;
	} catch {
		return new Database(DB_PATH);
	}
}

async function main(): Promise<number> {
	const db = openDb();

	if (process.argv.includes("--scan")) {
		await scan(db);
		return 0;
	}

	const clients = await fetchClients();
	if (!clients) return 0; // dashboard unreachable → fail closed, retry next pass
	const pushed = loadPushed();
	const attempts = loadAttempts();

	for (const sid of readySessions(db)) {
		if (pushed.has(sid)) continue;
		const { title } = sessionMeta(db, sid);
		const matched = matchClients(title, clients);
		if (!matched) continue; // default-deny: not a client meeting

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
		log(`${sid} pushing "${title}" → ${matched.client.name} via "${matched.via}" (attempt ${n + 1})`);
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
