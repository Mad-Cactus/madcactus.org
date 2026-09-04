/**
 * Company brain — generated memory (Macro-style unified memory).
 *
 * Pattern verified against macro-inc/macro `crates/memory`:
 *   - memory = one text blob per scope (company / client), not RAG
 *   - get_or_generate: serve stored blob; if older than 24h fire a
 *     background regen seeded with the previous blob as baseline
 *   - generation = LLM tool-loop over workspace search tools
 *   - output wrapped in <memory> tags, narration deterministically stripped
 *   - second LLM pass judges quality; rejected → old memory stays
 *
 * Facts stay in the sources (email, docs, gbrain); the blob holds only
 * durable context worth prepending to every prompt.
 */
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
	companies,
	deliverables,
	docs,
	documents,
	emailMessages,
	emailThreads,
	projects,
	memories,
} from "~/db/schema";

export type MemoryScope = "company" | "client";

const STALE_MS = 24 * 60 * 60 * 1000;
const MAX_TOOL_ROUNDS = 8;

const BRAIN_MODEL = process.env.BRAIN_MODEL || "anthropic/claude-sonnet-4.5";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// ── Prompt blocks (ported from crates/memory/src/domain/service.rs) ──

const GENERATE_PROMPT = (scopeLabel: string, datetime: string) => `\
Use tool calls to research this business — what it does, who its clients are, \
what's actively being worked on, and anything else useful as permanent context. \
Search emails, documents, projects, deliverables, and the knowledge brain.

Then generate a ~1000-3000 word memory about ${scopeLabel} that will be prepended \
to future agent prompts. Focus on:
- What the business does and how it makes money
- Active clients, projects, and their current state
- Key people, communication style, and relationships
- Domain knowledge (logistics, freight, customs — whatever the work shows)
- Current priorities and open threads

If a previous memory is provided, use it as the baseline: preserve still-accurate \
durable facts, update with fresh tool research, drop obsolete details.

Don't include things that would make sense to find via tool search at runtime — \
recent message bodies, invoice amounts, etc. Focus on permanent background knowledge.

Output format: wrap the finished memory in <memory></memory> tags. Everything \
outside the tags is discarded, and a response without the tags is rejected entirely. \
Inside the tags, write only the memory itself — no preamble, no narration of your \
research process.`;

const JUDGE_PROMPT = `\
You are a strict quality judge for AI-generated business memory profiles.

A "memory" is a ~1000-3000 word summary prepended to future agent prompts. \
A good memory is built from rich data: emails, documents, projects, deliverables.

REJECT if ANY of the following are true:
- Based on insufficient data (nearly empty workspace → useless speculation)
- Mostly guesswork or hedged inferences ("likely", "suggests", "may")
- Under ~500 words of substantive content
- Lacks specific details about actual clients, projects, or work
- Contains the generator's narration anywhere ("I have enough context", "Now I have...")

ACCEPT only if the memory contains concrete, specific context derived from \
substantial workspace data that would meaningfully improve future agent sessions.`;

// ── Extraction / staleness (pure, tested) ───────────────────────────

/** Port of Macro's extract_memory_body: first <memory> to LAST </memory>. */
export function extractMemoryBody(content: string): string | null {
	const start = content.indexOf("<memory>");
	if (start === -1) return null;
	const body = start + "<memory>".length;
	const end = content.lastIndexOf("</memory>");
	if (end === -1 || end < body) return null;
	return content.slice(body, end).trim() || null;
}

export function isStale(generatedAt: Date, now = new Date()): boolean {
	return now.getTime() - generatedAt.getTime() > STALE_MS;
}

/** Parse the judge's JSON, tolerating markdown fences. */
export function parseJudgement(raw: string): { accepted: boolean; reason: string } {
	const stripped = raw.replace(/```(?:json)?/g, "").trim();
	const start = stripped.indexOf("{");
	const end = stripped.lastIndexOf("}");
	if (start === -1 || end === -1) throw new Error(`judge returned no JSON: ${raw.slice(0, 200)}`);
	const parsed = JSON.parse(stripped.slice(start, end + 1));
	if (typeof parsed.accepted !== "boolean" || typeof parsed.reason !== "string") {
		throw new Error(`judge JSON malformed: ${raw.slice(0, 200)}`);
	}
	return parsed;
}

// ── Search tools (shared by generation loop and brain MCP) ──────────

export async function searchWorkspace(query: string) {
	const q = query.trim();
	if (!q) return { emails: [], documents: [], docs: [], projects: [] };
	const tsq = sql`websearch_to_tsquery('english', ${q})`;
	const like = `%${q}%`;

	const emails = await db
		.select({
			subject: emailThreads.subject,
			from: emailMessages.fromName,
			date: emailMessages.date,
			snippet: sql<string>`left(${emailMessages.bodyText}, 400)`,
		})
		.from(emailMessages)
		.innerJoin(emailThreads, eq(emailThreads.id, emailMessages.threadId))
		.where(
			sql`to_tsvector('english', coalesce(${emailThreads.subject},'') || ' ' || ${emailMessages.bodyText}) @@ ${tsq}`,
		)
		.orderBy(desc(emailMessages.date))
		.limit(10);

	const docHits = await db
		.select({
			title: documents.title,
			created: documents.createdAt,
			snippet: sql<string>`left(coalesce(${documents.content}, ${documents.description}), 400)`,
		})
		.from(documents)
		.where(
			sql`to_tsvector('english', coalesce(${documents.title},'') || ' ' || coalesce(${documents.content},'') || ' ' || coalesce(${documents.description},'')) @@ ${tsq}`,
		)
		.orderBy(desc(documents.createdAt))
		.limit(10);

	const proj = await db
		.select({
			name: projects.name,
			status: projects.status,
			notes: projects.notes,
			company: companies.name,
		})
		.from(projects)
		.innerJoin(companies, eq(companies.id, projects.companyId))
		.where(sql`${projects.name} ILIKE ${like} OR coalesce(${projects.notes},'') ILIKE ${like} OR ${companies.name} ILIKE ${like}`)
		.limit(10);

	// workspace docs (markdown, versioned) — includes the Voice lessons corpus
	const mdDocs = await db
		.select({
			title: docs.title,
			status: docs.status,
			updated: docs.updatedAt,
			snippet: sql<string>`left(${docs.markdown}, 400)`,
		})
		.from(docs)
		.where(sql`to_tsvector('english', ${docs.title} || ' ' || ${docs.markdown}) @@ ${tsq}`)
		.orderBy(desc(docs.updatedAt))
		.limit(10);

	return { emails, documents: docHits, docs: mdDocs, projects: proj };
}

export async function recentActivity(days = 14) {
	const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
	const [emailCount] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(emailMessages)
		.where(gte(emailMessages.date, since));
	const recentEmails = await db
		.select({
			subject: emailThreads.subject,
			from: emailMessages.fromName,
			date: emailMessages.date,
		})
		.from(emailMessages)
		.innerJoin(emailThreads, eq(emailThreads.id, emailMessages.threadId))
		.where(gte(emailMessages.date, since))
		.orderBy(desc(emailMessages.date))
		.limit(20);
	const recentDocs = await db
		.select({ title: documents.title, created: documents.createdAt })
		.from(documents)
		.where(gte(documents.createdAt, since))
		.orderBy(desc(documents.createdAt))
		.limit(20);
	const activeProjects = await db
		.select({ name: projects.name, status: projects.status, company: companies.name })
		.from(projects)
		.innerJoin(companies, eq(companies.id, projects.companyId))
		.where(eq(projects.status, "active"));
	const openDeliverables = await db
		.select({ title: deliverables.title, status: deliverables.status, project: projects.name })
		.from(deliverables)
		.innerJoin(projects, eq(projects.id, deliverables.projectId))
		.where(sql`${deliverables.status} <> 'completed'`)
		.limit(30);
	return {
		since_days: days,
		email_count: emailCount?.n ?? 0,
		recent_emails: recentEmails,
		recent_documents: recentDocs,
		active_projects: activeProjects,
		open_deliverables: openDeliverables,
	};
}

/** Proxy to a hosted gbrain (`gbrain serve --http`, bearer token). */
export async function searchBrain(query: string) {
	const url = process.env.GBRAIN_URL;
	const token = process.env.GBRAIN_TOKEN;
	if (!url || !token) return { error: "gbrain not configured (set GBRAIN_URL + GBRAIN_TOKEN)" };
	const res = await fetch(`${url.replace(/\/$/, "")}/mcp`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: "gbrain_query", arguments: { query } },
		}),
	});
	if (!res.ok) return { error: `gbrain HTTP ${res.status}` };
	const body = await res.json();
	if (body.error) return { error: body.error.message ?? "gbrain error" };
	const text = body.result?.content?.map((c: { text?: string }) => c.text ?? "").join("\n");
	return { results: text ?? JSON.stringify(body.result) };
}

// ── LLM (OpenRouter, plain fetch) ───────────────────────────────────

type ToolCall = { id: string; name: string; args: Record<string, unknown> };

async function llm(messages: unknown[], tools?: unknown[]) {
	const key = process.env.OPENROUTER_API_KEY;
	if (!key) throw new Error("OPENROUTER_API_KEY not set");
	const res = await fetch(OPENROUTER_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
		body: JSON.stringify({ model: BRAIN_MODEL, messages, ...(tools ? { tools } : {}) }),
	});
	if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
	return res.json();
}

async function runToolLoop(system: string, user: string): Promise<string> {
	const tools = [
		{
			type: "function",
			function: {
				name: "search_workspace",
				description: "Full-text search across emails, documents, and projects.",
				parameters: {
					type: "object",
					properties: { query: { type: "string" } },
					required: ["query"],
				},
			},
		},
		{
			type: "function",
			function: {
				name: "recent_activity",
				description: "What changed recently: email/doc counts, latest emails and docs, active projects, open deliverables.",
				parameters: {
					type: "object",
					properties: { days: { type: "number", description: "lookback window, default 14" } },
				},
			},
		},
		{
			type: "function",
			function: {
				name: "search_brain",
				description: "Search the long-term knowledge brain (gbrain) — synced meetings, sessions, connectors.",
				parameters: {
					type: "object",
					properties: { query: { type: "string" } },
					required: ["query"],
				},
			},
		},
	];

	const messages: unknown[] = [
		{ role: "system", content: system },
		{ role: "user", content: user },
	];

	for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
		const res = await llm(messages, tools);
		const msg = res.choices?.[0]?.message;
		if (!msg) throw new Error("LLM returned no message");
		messages.push(msg);

		const calls: ToolCall[] = (msg.tool_calls ?? []).map((tc: any) => ({
			id: tc.id,
			name: tc.function.name,
			args: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
		}));
		if (calls.length === 0) return msg.content ?? "";

		for (const call of calls) {
			let result: unknown;
			try {
				if (call.name === "search_workspace") result = await searchWorkspace(String(call.args.query ?? ""));
				else if (call.name === "recent_activity") result = await recentActivity(Number(call.args.days) || 14);
				else if (call.name === "search_brain") result = await searchBrain(String(call.args.query ?? ""));
				else result = { error: `unknown tool ${call.name}` };
			} catch (err) {
				result = { error: err instanceof Error ? err.message : String(err) };
			}
			messages.push({
				role: "tool",
				tool_call_id: call.id,
				content: JSON.stringify(result).slice(0, 20000),
			});
		}
	}
	throw new Error(`tool loop hit ${MAX_TOOL_ROUNDS} rounds without final answer`);
}

// ── Get-or-generate (the Macro loop) ────────────────────────────────

async function getRow(scope: MemoryScope, companyId: string | null) {
	const [row] = await db
		.select()
		.from(memories)
		.where(
			and(
				eq(memories.scope, scope),
				scope === "client" && companyId ? eq(memories.companyId, companyId) : isNull(memories.companyId),
			),
		)
		.limit(1);
	return row ?? null;
}

/**
 * Serve the stored memory; fire a background regen when missing or stale.
 * Mirrors Macro's get_or_generate_memory: never blocks on generation.
 */
export async function getMemory(scope: MemoryScope, companyId: string | null = null) {
	const row = await getRow(scope, companyId);
	if (!row || (isStale(row.generatedAt) && row.status !== "generating")) {
		void regenMemory(scope, companyId).catch(() => {});
	}
	if (!row || row.status !== "ready" || !row.content) {
		return { memory: null as string | null, generatedAt: null as Date | null };
	}
	return { memory: row.content, generatedAt: row.generatedAt };
}

/**
 * Full regen: generate via tool loop, judge, save. Concurrency-safe via a
 * conditional update that claims the row (or inserts a claiming row).
 */
export async function regenMemory(scope: MemoryScope, companyId: string | null = null) {
	// claim: insert if absent, else flip ready/failed → generating
	const claimed = await db
		.insert(memories)
		.values({ scope, companyId, content: "", status: "generating", model: BRAIN_MODEL })
		.onConflictDoNothing()
		.returning({ id: memories.id });
	if (claimed.length === 0) {
		const updated = await db
			.update(memories)
			.set({ status: "generating", lastError: null })
			.where(
				and(
					eq(memories.scope, scope),
					scope === "client" && companyId ? eq(memories.companyId, companyId) : isNull(memories.companyId),
					sql`${memories.status} <> 'generating'`,
				),
			)
			.returning({ id: memories.id });
		if (updated.length === 0) return; // another regen already in flight
	}

	try {
		const scopeLabel = scope === "company" ? "this company (Mad Cactus)" : "this client engagement";
		let system = `You are the memory generator for the Mad Cactus company brain. Today is ${new Date().toUTCString()}.`;
		if (scope === "client" && companyId) {
			const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
			const { memory: companyMemory } = await getMemory("company");
			system += `\n\nClient: ${company?.name ?? companyId}.`;
			if (companyMemory) system += `\n\nCompany-level memory for context:\n<company_memory>\n${companyMemory}\n</company_memory>`;
		}

		const raw = await runToolLoop(system, GENERATE_PROMPT(scopeLabel, new Date().toUTCString()));
		const memory = extractMemoryBody(raw);
		if (!memory) throw new Error("generation output missing <memory> tags");

		const judgeRaw = await llm(
			[
				{ role: "system", content: JUDGE_PROMPT },
				{
					role: "user",
					content: `Evaluate this memory and respond with ONLY a JSON object (no markdown, no code fences):\n{"accepted": true/false, "reason": "one sentence explanation"}\n\n---\n\n${memory}`,
				},
			],
		);
		const judgement = parseJudgement(judgeRaw.choices?.[0]?.message?.content ?? "");
		if (!judgement.accepted) throw new Error(`memory rejected by judge: ${judgement.reason}`);

		await db
			.update(memories)
			.set({ content: memory, status: "ready", model: BRAIN_MODEL, generatedAt: new Date(), lastError: null })
			.where(
				and(
					eq(memories.scope, scope),
					scope === "client" && companyId ? eq(memories.companyId, companyId) : isNull(memories.companyId),
				),
			);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		await db
			.update(memories)
			.set({ status: "failed", lastError: msg.slice(0, 500) })
			.where(
				and(
					eq(memories.scope, scope),
					scope === "client" && companyId ? eq(memories.companyId, companyId) : isNull(memories.companyId),
				),
			)
			.catch(() => {});
		throw err;
	}
}
