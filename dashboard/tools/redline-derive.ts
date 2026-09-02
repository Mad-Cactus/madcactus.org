// Redline derivation sidecar — runs LOCALLY (it reads ~/.pi transcripts),
// talks to the dashboard over the redline MCP endpoint.
//
// Loop: list_derivation_jobs → find + slice the writer's pi session via
// chat_uuid → zero-tool one-shot pi derives 0-3 lessons (+ lintable patterns)
// → add_lesson/add_pattern → complete_derivation_job.
//
// Port of macro's tooling/gbrain/derive.ts. Run from dashboard/:
//   bun tools/redline-derive.ts            # loop forever (POLL_MS, default 60s)
//   bun tools/redline-derive.ts --once     # drain pending jobs and exit
//
// Env (auto-loaded from dashboard/.env): REDLINE_MCP_URL, REDLINE_MCP_KEY,
// optional PI_BIN (default "pi"), POLL_MS, MAX_TRANSCRIPT_CHARS (default 80k).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const MCP_URL = process.env.REDLINE_MCP_URL ?? "http://localhost:3000/api/redline-mcp";
const MCP_KEY = process.env.REDLINE_MCP_KEY ?? "";
const PI_BIN = process.env.PI_BIN ?? "pi";
const POLL_MS = Number(process.env.POLL_MS ?? 60_000);
const MAX_DERIVE_MS = 5 * 60_000;
const SESSIONS_DIR = process.env.PI_SESSIONS_DIR ?? join(homedir(), ".pi/agent/sessions");

if (!MCP_KEY) {
	console.error("REDLINE_MCP_KEY not set — add it to dashboard/.env");
	process.exit(1);
}

type Json = Record<string, any>;

async function mcp(tool: string, args: Json = {}): Promise<Json> {
	const res = await fetch(MCP_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${MCP_KEY}` },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: tool, arguments: args },
		}),
	});
	const body = (await res.json()) as Json;
	if (body.error) throw new Error(`${tool}: ${body.error.message}`);
	const text = (body.result?.content?.[0]?.text as string) ?? "{}";
	return JSON.parse(text);
}

// ── pi session lookup ──────────────────────────────────────────────

function findSessionByUuid(chatUuid: string): string | null {
	for (const cwdDir of readdirSync(SESSIONS_DIR, { withFileTypes: true })) {
		if (!cwdDir.isDirectory()) continue;
		const dir = join(SESSIONS_DIR, cwdDir.name);
		for (const f of readdirSync(dir)) {
			if (f.endsWith(`_${chatUuid}.jsonl`)) return join(dir, f);
		}
	}
	return null;
}

// Fallback: newest session whose transcript contains the draft id + the tool
// call that produced it (pairs created before chat_uuid stamping).
function findWriterSession(draftId: string): string | null {
	const candidates: { path: string; mtime: number }[] = [];
	for (const cwdDir of readdirSync(SESSIONS_DIR, { withFileTypes: true })) {
		if (!cwdDir.isDirectory()) continue;
		const dir = join(SESSIONS_DIR, cwdDir.name);
		for (const f of readdirSync(dir)) {
			if (!f.endsWith(".jsonl")) continue;
			const p = join(dir, f);
			try {
				candidates.push({ path: p, mtime: require("node:fs").statSync(p).mtimeMs });
			} catch {}
		}
	}
	candidates.sort((a, b) => b.mtime - a.mtime);
	for (const { path } of candidates.slice(0, 400)) {
		try {
			const body = readFileSync(path, "utf8");
			if (body.includes(draftId) && body.includes("create_draft")) return path;
		} catch {}
	}
	return null;
}

// ── slice transcript to the create_draft call ──────────────────────

function sliceToWrite(sessionPath: string, draftId: string, draftSnippet: string): string {
	const msgs: string[] = [];
	for (const line of readFileSync(sessionPath, "utf8").split("\n")) {
		if (!line.trim()) continue;
		let ev: any;
		try {
			ev = JSON.parse(line);
		} catch {
			continue;
		}
		const m = ev.type === "message" ? ev.message : null;
		if (!m) continue;
		const content = Array.isArray(m.content)
			? m.content
					.map((c: any) =>
						c.type === "text"
							? c.text
							: c.type === "tool_use" || c.type === "tool_call"
								? `[tool ${c.name}] ${JSON.stringify(c.input ?? c.arguments ?? {}).slice(0, 400)}`
								: "",
					)
					.join("\n")
			: String(m.content ?? "");
		msgs.push(`${String(m.role).toUpperCase()}: ${content}`);
		if (content.includes("create_draft") && (content.includes(draftId) || content.includes(draftSnippet))) {
			break; // keep this message (it made the call), stop after
		}
	}
	// ponytail: cap at last 60 messages / 80k chars — derivation cares about
	// the tail (ask → constraints → draft). If quality suffers, add chunk folding.
	return msgs.slice(-60).join("\n---\n").slice(-Number(process.env.MAX_TRANSCRIPT_CHARS ?? 80_000));
}

// ── derivation ─────────────────────────────────────────────────────

interface DerivedLesson {
	lesson: string;
	tags?: string;
	patterns?: { rule: string; pattern: string; pattern_type?: string; direction?: string; category?: string }[];
}

function buildPrompt(transcript: string, draft: string, final: string, existingRules: string[]): string {
	return `You are deriving writing lessons from an edited AI draft. Below:
1. The conversation (truncated) between a human and the AI agent that wrote the draft.
2. The draft the agent produced.
3. The final text after the human edited it by hand.
4. Existing lesson rules — do NOT restate these.

Derive 0-3 lessons: generalizable, testable writing rules explaining WHY the human edited as they did. A lesson must be something a future draft could be linted against. Prefer fewer, sharper lessons. If the edit is trivial (typos, formatting), derive nothing — output an empty array.

Output STRICT JSON only, no prose, no markdown fences:
{"lessons":[{"lesson":"...","tags":"doc","patterns":[{"rule":"...","pattern":"literal substring to avoid or prefer","pattern_type":"literal","direction":"avoid","category":"style"}]}]}

Rules for patterns: pattern is a literal substring that would appear in a BAD draft (direction=avoid) or a GOOD draft (direction=prefer). Only include a pattern if you are confident it generalizes. category: style|structure|tone|wording.

=== CONVERSATION (tail, may be truncated) ===
${transcript}

=== AGENT DRAFT ===
${draft}

=== HUMAN FINAL ===
${final}

=== EXISTING RULES (do not restate) ===
${existingRules.map((r) => `- ${r}`).join("\n") || "(none)"}`;
}

async function derive(job: Json, existingRules: string[]): Promise<string> {
	const snippet = String(job.draftContent).slice(0, 80);
	const sessionPath =
		(job.chatUuid ? findSessionByUuid(String(job.chatUuid)) : null) ??
		(job.draftId ? findWriterSession(String(job.draftId)) : null);
	if (!sessionPath) {
		await mcp("complete_derivation_job", {
			job_id: job.jobId,
			status: "failed",
			error: "no writer session found — pair stored, lessons skipped",
		});
		return "skip: no session";
	}

	const transcript = sliceToWrite(sessionPath, String(job.draftId ?? ""), snippet);
	const prompt = buildPrompt(transcript, String(job.draftContent), String(job.finalContent), existingRules);

	const proc = Bun.spawn([PI_BIN, "-p", "--no-tools", "--no-session", prompt], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const timer = setTimeout(() => proc.kill(), MAX_DERIVE_MS);
	const out = await new Response(proc.stdout).text();
	clearTimeout(timer);
	const code = await proc.exited;
	if (code !== 0) throw new Error(`pi exited ${code}: ${(await new Response(proc.stderr).text()).slice(0, 200)}`);

	const cleaned = out.replace(/```(json)?/g, "").trim();
	const start = cleaned.indexOf("{");
	const end = cleaned.lastIndexOf("}");
	const lessons: DerivedLesson[] = JSON.parse(cleaned.slice(start, end + 1)).lessons?.slice(0, 3) ?? [];

	let lessonsAdded = 0;
	let patternsAdded = 0;
	for (const l of lessons) {
		if (!l.lesson || l.lesson.length > 1000) continue;
		const lesson = await mcp("add_lesson", {
			pair_id: job.pairId,
			lesson: l.lesson,
			tags: l.tags ?? `${job.surface ?? "doc"},derived`,
		});
		lessonsAdded++;
		for (const p of l.patterns ?? []) {
			if (!p.rule || !p.pattern || p.pattern.length > 200) continue;
			try {
				await mcp("add_pattern", {
					lesson_id: lesson.id,
					rule: p.rule,
					pattern: p.pattern,
					pattern_type: p.pattern_type === "regex" ? "regex" : "literal",
					direction: p.direction === "prefer" ? "prefer" : "avoid",
					category: ["style", "structure", "tone", "wording"].includes(p.category ?? "") ? p.category : "style",
				});
				patternsAdded++;
			} catch {
				// duplicate pattern or bad regex — skip, not fatal
			}
		}
	}

	await mcp("complete_derivation_job", { job_id: job.jobId, status: "done" });
	return `${lessonsAdded} lesson(s), ${patternsAdded} pattern(s) from ${sessionPath.split("/").slice(-2).join("/")}`;
}

// ── main loop ──────────────────────────────────────────────────────

async function drainOnce() {
	const jobs = await mcp("list_derivation_jobs", { limit: 5 });
	if (!Array.isArray(jobs) || jobs.length === 0) return false;
	const patternRows = await mcp("list_patterns");
	const existingRules: string[] = Array.isArray(patternRows) ? patternRows.map((p: any) => p.rule) : [];
	for (const job of jobs) {
		try {
			console.log(`[${new Date().toISOString()}] deriving pair ${job.pairId}…`);
			console.log(`  → ${await derive(job, existingRules)}`);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error(`  FAIL: ${msg}`);
			await mcp("complete_derivation_job", { job_id: job.jobId, status: "failed", error: msg.slice(0, 500) }).catch(() => {});
		}
	}
	return true;
}

const once = process.argv.includes("--once");
do {
	try {
		const worked = await drainOnce();
		if (once) break;
		if (!worked) await Bun.sleep(POLL_MS);
	} catch (e) {
		console.error(`[${new Date().toISOString()}] ${e instanceof Error ? e.message : e}`);
		if (once) process.exit(1);
		await Bun.sleep(POLL_MS);
	}
} while (!once);
