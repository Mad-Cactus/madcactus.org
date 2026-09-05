// Brain distillation — the LLM cycle phases (gbrain's extract_facts /
// consolidate / enrich), fed by workspace content since the last cursor.
// Deterministic phases live in ingest.ts; runCycle() orchestrates both and
// is lazily triggered by brain MCP calls (24h staleness). Facts are NEVER
// deleted — supersession chains are the audit trail.
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
	brainChunks,
	brainFacts,
	brainPages,
	brainState,
	brainTakes,
	companies,
	documents,
	emailMessages,
	emailThreads,
	projects,
	slackChannels,
	slackMessages,
	textVersions,
} from "~/db/schema";
import { chunkText, factHash, slugify } from "./core";
import { syncEntities, syncPersons, syncProspects, detectLoops, backfillTimeline, recomputeWeight } from "./ingest";
import { embedPending } from "./embed";
import { syncSlack } from "~/lib/slack";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function brainModel(): string {
	return process.env.BRAIN_MODEL || "anthropic/claude-sonnet-4.5";
}

async function llm(system: string, user: string): Promise<string> {
	const key = process.env.OPENROUTER_API_KEY;
	if (!key) throw new Error("OPENROUTER_API_KEY not set");
	const res = await fetch(OPENROUTER_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
		body: JSON.stringify({
			model: brainModel(),
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: user },
			],
		}),
	});
	if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
	const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
	return body.choices?.[0]?.message?.content ?? "";
}

/** First JSON array in the response — tolerates fences/narration. */
export function parseJsonArray(text: string): unknown[] {
	const start = text.indexOf("[");
	const end = text.lastIndexOf("]");
	if (start === -1 || end <= start) throw new Error("no JSON array in LLM output");
	return JSON.parse(text.slice(start, end + 1)) as unknown[];
}

// ── Cursors (brain_state) ──────────────────────────────────────────

async function getCursor(key: string): Promise<string | null> {
	const [row] = await db.select({ value: brainState.value }).from(brainState).where(eq(brainState.key, key));
	const v = row?.value as { at?: string } | undefined;
	return v?.at || null;
}

async function setCursor(key: string, at: string) {
	await db
		.insert(brainState)
		.values({ key, value: { at } })
		.onConflictDoUpdate({ target: brainState.key, set: { value: { at } } });
}

// ── extract_lessons (the diff engine) ──────────────────────────────

export type VersionRow = {
	id: string;
	entity: string; // 'doc' | 'email_draft'
	entityId: string;
	author: string;
	content: string;
	createdAt: Date;
};

export type LessonPair = {
	entity: string;
	entityId: string;
	agent: VersionRow;
	human: VersionRow;
};

/**
 * Pair agent writes with the human edit that followed them — each pair is one
 * "what the agent did vs what Collin kept" data point. The most recent agent
 * version before each human version is its counterpart; each agent version
 * pairs at most once. Versions must be ascending by createdAt.
 */
export function findPairs(versions: VersionRow[]): LessonPair[] {
	const byEntity = new Map<string, VersionRow[]>();
	for (const v of versions) {
		const list = byEntity.get(v.entityId) ?? [];
		list.push(v);
		byEntity.set(v.entityId, list);
	}
	const pairs: LessonPair[] = [];
	for (const [, list] of byEntity) {
		list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
		let pendingAgent: VersionRow | null = null;
		let pendingHuman: VersionRow | null = null;
		const flush = () => {
			if (pendingAgent && pendingHuman) {
				pairs.push({ entity: pendingHuman.entity, entityId: pendingHuman.entityId, agent: pendingAgent, human: pendingHuman });
			}
			pendingAgent = null;
			pendingHuman = null;
		};
		for (const v of list) {
			if (v.author === "agent") {
				flush(); // previous round ends when the agent writes again
				pendingAgent = v;
			} else {
				pendingHuman = v; // consecutive human edits: keep the latest
			}
		}
		flush();
	}
	return pairs;
}

const LESSONS_SYSTEM = `You derive durable writing lessons from editing pairs.
Input: pairs of (agent draft, Collin's final text). For each pair output the LESSONS a writing agent should learn:
[{"lesson": "<one durable rule, stated as a preference>", "entity": "<client/topic name it applies to, or 'voice' if universal>"}]
Rules: lessons are general ("Cut the throat-clearing opener", "Use 'Glad' not 'Sounds like'"), never quote the whole text. 0-2 lessons per pair — skip pairs with nothing to learn. Output ONLY the JSON array.`;

/** Learn from diffs: agent write → human edit pairs become lesson facts. */
export async function extractLessons(opts: { maxPairs?: number; maxChars?: number } = {}): Promise<{ pairs: number; lessons: number }> {
	const maxPairs = opts.maxPairs ?? 8;
	const maxChars = opts.maxChars ?? 2000;
	const since = await getCursor("extract_lessons");
	const sinceDate = since ? new Date(since) : new Date(Date.now() - 30 * 86_400_000);

	const rows = await db
		.select()
		.from(textVersions)
		.where(and(gt(textVersions.createdAt, sinceDate), inArray(textVersions.entity, ["doc", "email_draft"])))
		.orderBy(textVersions.createdAt)
		.limit(100);

	const pairs = findPairs(
		rows.map((r) => ({
			id: r.id,
			entity: r.entity,
			entityId: r.entityId,
			author: r.author,
			content: r.content,
			createdAt: r.createdAt,
		})),
	).slice(-maxPairs);

	if (pairs.length === 0) {
		const last = rows.at(-1)?.createdAt;
		if (last) await setCursor("extract_lessons", last.toISOString());
		return { pairs: 0, lessons: 0 };
	}

	let lessons = 0;
	let newest: Date | null = null;
	for (const p of pairs) {
		const prompt = `PAIR — agent draft:
${p.agent.content.slice(0, maxChars)}

Collin's final:
${p.human.content.slice(0, maxChars)}`;
		const out = parseJsonArray(await llm(LESSONS_SYSTEM, prompt)) as { lesson?: string; entity?: string }[];
		for (const item of out) {
			if (!item?.lesson) continue;
			await insertFacts(
				[{ entity: item.entity ?? "voice", fact: item.lesson, kind: "lesson", notability: "high", confidence: 0.9 }],
				{ sourceTable: "text_versions", sourceId: p.human.id, surface: surfaceForPair(p.entity) },
			);
			lessons++;
		}
		if (!newest || p.human.createdAt > newest) newest = p.human.createdAt;
	}
	if (newest) await setCursor("extract_lessons", newest.toISOString());
	return { pairs: pairs.length, lessons };
}

// ── extract_facts ──────────────────────────────────────────────────

type ExtractedFact = {
	entity: string;
	fact: string;
	kind?: string;
	notability?: string;
	confidence?: number;
};

const EXTRACT_SYSTEM = `You extract durable facts for a consulting firm's company brain.
Given recent workspace content (emails, doc edits), output a JSON array of facts worth remembering:
[{"entity": "<client/person/project name as it appears>", "fact": "<one atomic, durable statement>", "kind": "event|preference|commitment|belief|fact|idea", "notability": "high|medium|low", "confidence": 0.0-1.0}]
Rules: only durable facts (relationships, decisions, preferences, commitments, project state) — not chatter.
Never invent. One atomic fact per item. Output ONLY the JSON array.`;

/** Which surface a lesson/fact applies to — rules differ per surface. */
export function surfaceForPair(entity: string): string {
	if (entity === "email_draft") return "email";
	if (entity === "doc") return "docs";
	return entity;
}

/** Insert facts with deterministic dedup (entity + normalized-text hash). */
export async function insertFacts(
	facts: (ExtractedFact & { speaker?: string })[],
	provenance: { sourceTable: string; sourceId?: string; surface?: string },
) {
	let inserted = 0;
	let skipped = 0;
	for (const f of facts) {
		if (!f?.entity || !f?.fact) continue;
		try {
			await db
				.insert(brainFacts)
				.values({
					entitySlug: slugify(f.entity),
					fact: f.fact,
					kind: (f.kind as never) ?? "fact",
					notability: (f.notability as never) ?? "medium",
					confidence: typeof f.confidence === "number" ? Math.min(1, Math.max(0, f.confidence)) : 1,
					sourceTable: provenance.sourceTable,
					sourceId: provenance.sourceId,
					surface: provenance.surface,
					context: f.speaker ? `said by ${f.speaker}` : null,
					factHash: factHash(f.fact),
				})
				.onConflictDoNothing({ target: [brainFacts.entitySlug, brainFacts.factHash] });
			inserted++;
		} catch {
			skipped++;
		}
	}
	return { inserted, skipped };
}

/** Extract facts from email + doc-version content newer than the cursor. */
export async function extractFacts(opts: { maxChars?: number } = {}): Promise<{ inserted: number; skipped: number; sources: number }> {
	const maxChars = opts.maxChars ?? 24000;
	const since = await getCursor("extract_facts");
	const sinceDate = since ? new Date(since) : new Date(Date.now() - 7 * 86_400_000);

	const emails = await db
		.select({
			id: emailMessages.id,
			date: emailMessages.date,
			subject: emailThreads.subject,
			from: emailMessages.fromName,
			body: emailMessages.bodyText,
		})
		.from(emailMessages)
		.innerJoin(emailThreads, eq(emailThreads.id, emailMessages.threadId))
		.where(gt(emailMessages.date, sinceDate))
		.orderBy(desc(emailMessages.date))
		.limit(40);

	const docEdits = await db
		.select({
			id: textVersions.id,
			date: textVersions.createdAt,
			author: textVersions.author,
			content: textVersions.content,
		})
		.from(textVersions)
		.where(and(gt(textVersions.createdAt, sinceDate), eq(textVersions.entity, "doc")))
		.orderBy(desc(textVersions.createdAt))
		.limit(20);

	// build the batch, newest first, capped at maxChars
	let batch = "";
	let newest: Date | null = null;
	let sources = 0;
	for (const m of emails) {
		const block = `EMAIL ${m.date.toISOString()} — ${m.subject} (from ${m.from ?? "unknown"}):\n${(m.body ?? "").slice(0, 4000)}\n\n`;
		if (batch.length + block.length > maxChars) break;
		batch += block;
		if (!newest || m.date > newest) newest = m.date;
		sources++;
	}
	for (const d of docEdits) {
		const block = `DOC EDIT ${d.date.toISOString()} (${d.author}):\n${d.content.slice(0, 4000)}\n\n`;
		if (batch.length + block.length > maxChars) break;
		batch += block;
		if (!newest || d.date > newest) newest = d.date;
		sources++;
	}

	if (!batch.trim()) {
		if (newest) await setCursor("extract_facts", newest.toISOString());
		return { inserted: 0, skipped: 0, sources: 0 };
	}

	const out = parseJsonArray(await llm(EXTRACT_SYSTEM, batch)) as ExtractedFact[];
	const res = await insertFacts(out, { sourceTable: "email_messages" });
	if (newest) await setCursor("extract_facts", newest.toISOString());
	return { ...res, sources };
}

// ── extract_transcripts (meetings, speaker-attributed) ─────────────

const TRANSCRIPT_SYSTEM = `You extract durable facts from a meeting transcript for a consulting firm's company brain.
Output a JSON array:
[{"entity": "<client/project the fact is about>", "speaker": "<who said it, exactly as labeled>", "fact": "<one atomic durable statement, attributed>", "kind": "event|preference|commitment|belief|fact|idea", "notability": "high|medium|low", "confidence": 0.0-1.0}]
Rules: decisions, commitments, preferences, objections, project state — not small talk. Attribute the fact to its speaker in "speaker". Never invent. Output ONLY the JSON array.`;

/**
 * Distill meeting transcripts into speaker-attributed facts. Reprocessing
 * (after diarization improves) expires the old document-sourced facts and
 * re-extracts — the audit trail keeps the expired rows.
 */
export async function extractTranscripts(
	opts: { maxChars?: number; reprocess?: boolean } = {},
): Promise<{ meetings: number; inserted: number }> {
	const maxChars = opts.maxChars ?? 24000;
	if (opts.reprocess) {
		await db
			.update(brainFacts)
			.set({ expiredAt: new Date() })
			.where(and(eq(brainFacts.sourceTable, "documents"), isNull(brainFacts.expiredAt)));
		await setCursor("extract_transcripts", "");
	}
	const since = await getCursor("extract_transcripts");
	const sinceDate = since ? new Date(since) : new Date(Date.now() - 90 * 86_400_000);

	const meetings = await db
		.select({
			id: documents.id,
			title: documents.title,
			transcriptJson: documents.transcriptJson,
			createdAt: documents.createdAt,
			company: companies.name,
		})
		.from(documents)
		.leftJoin(projects, eq(projects.id, documents.projectId))
		.leftJoin(companies, eq(companies.id, projects.companyId))
		.where(and(eq(documents.type, "transcript"), gt(documents.createdAt, sinceDate)))
		.orderBy(desc(documents.createdAt))
		.limit(5);

	let inserted = 0;
	let newest: Date | null = null;
	for (const doc of meetings) {
		if (!doc.transcriptJson) continue;
		let turns: { speaker?: string; text?: string }[] = [];
		try {
			turns = JSON.parse(doc.transcriptJson) as typeof turns;
		} catch {
			continue;
		}
		const transcript = turns
			.map((t) => `[${t.speaker ?? "unknown"}]: ${t.text ?? ""}`)
			.join("\n")
			.slice(0, maxChars);
		if (!transcript.trim()) continue;

		const out = parseJsonArray(
			await llm(
				TRANSCRIPT_SYSTEM,
				`Meeting: ${doc.title}${doc.company ? ` (client: ${doc.company})` : ""}\n\nTranscript:\n${transcript}`,
			),
		) as ExtractedFact[];
		const res = await insertFacts(out, { sourceTable: "documents", sourceId: doc.id, surface: "transcript" });
		inserted += res.inserted;
		// deterministic person events: every speaker gets an audit fact on their
		// person page — the base a person brief enriches from
		const meetingDate = doc.createdAt.toISOString().slice(0, 10);
		const speakerNames = [...new Set(turns.map((t) => (t.speaker ?? "").trim()).filter(Boolean))];
		for (const speaker of speakerNames) {
			if (/^speaker \d+$/i.test(speaker)) continue;
			await insertFacts(
				[
					{
						entity: `person ${speaker}`,
						fact: `Spoke in the meeting "${doc.title}" (${meetingDate})`,
						kind: "event",
						notability: "low",
						confidence: 1,
					},
				],
				{ sourceTable: "documents", sourceId: doc.id, surface: "transcript" },
			);
		}
		if (!newest || doc.createdAt > newest) newest = doc.createdAt;
	}
	if (newest && !opts.reprocess) await setCursor("extract_transcripts", newest.toISOString());
	if (opts.reprocess) await setCursor("extract_transcripts", new Date().toISOString());
	return { meetings: meetings.length, inserted };
}

// ── extract_slack_facts ────────────────────────────────────────────

/** Extract facts from slack messages newer than the cursor (channel hinted). */
export async function extractSlackFacts(opts: { maxChars?: number } = {}): Promise<{ inserted: number; sources: number }> {
	const maxChars = opts.maxChars ?? 20000;
	const since = await getCursor("extract_slack");
	const sinceDate = since ? new Date(since) : new Date(Date.now() - 7 * 86_400_000);

	const rows = await db
		.select({
			id: slackMessages.id,
			date: slackMessages.messageAt,
			text: slackMessages.text,
			channel: slackChannels.name,
			userName: slackMessages.userName,
		})
		.from(slackMessages)
		.innerJoin(slackChannels, eq(slackChannels.id, slackMessages.channelId))
		.where(gt(slackMessages.messageAt, sinceDate))
		.orderBy(slackMessages.messageAt)
		.limit(120);

	if (rows.length === 0) return { inserted: 0, sources: 0 };

	// one batch, channel+author labeled; provenance is table-level (slack
	// messages are chatty — per-fact source ids aren't worth the token cost)
	let batch = "";
	let newest: Date | null = null;
	for (const r of rows) {
		const block = `SLACK #${r.channel} ${r.date.toISOString()} — ${r.userName}: ${r.text.slice(0, 500)}\n`;
		if (batch.length + block.length > maxChars) break;
		batch += block;
		if (!newest || r.date > newest) newest = r.date;
	}
	if (!batch.trim()) return { inserted: 0, sources: 0 };

	const out = parseJsonArray(await llm(EXTRACT_SYSTEM, batch)) as ExtractedFact[];
	const res = await insertFacts(out, { sourceTable: "slack_messages", surface: "slack" });
	if (newest) await setCursor("extract_slack", newest.toISOString());
	return { inserted: res.inserted, sources: rows.length };
}

// ── consolidate (facts → takes) ────────────────────────────────────

const CONSOLIDATE_SYSTEM = `You consolidate facts about one entity into a single durable "take".
Given a list of facts, output a JSON array with exactly one object:
[{"claim": "<one paragraph synthesizing the current state of this entity>", "weight": 0.0-1.0}]
The claim must be consistent with the facts, no speculation. Output ONLY the JSON array.`;

/** Cluster unconsolidated facts per entity → one take (facts stay as audit). */
export async function consolidate(opts: { minFacts?: number; entitySlug?: string } = {}): Promise<{ entities: number }> {
	const minFacts = opts.minFacts ?? 5;
	const clusters = await db
		.select({ entitySlug: brainFacts.entitySlug, n: sql<number>`count(*)::int` })
		.from(brainFacts)
		.where(
			and(
				isNull(brainFacts.consolidatedAt),
				isNull(brainFacts.expiredAt),
				opts.entitySlug ? eq(brainFacts.entitySlug, opts.entitySlug) : sql`true`,
			),
		)
		.groupBy(brainFacts.entitySlug)
		.having(sql`count(*) >= ${minFacts}`);

	let entities = 0;
	for (const c of clusters) {
		const facts = await db
			.select({ fact: brainFacts.fact })
			.from(brainFacts)
			.where(and(eq(brainFacts.entitySlug, c.entitySlug), isNull(brainFacts.consolidatedAt)))
			.orderBy(desc(brainFacts.createdAt))
			.limit(50);
		const out = parseJsonArray(
			await llm(CONSOLIDATE_SYSTEM, `Entity: ${c.entitySlug}\n\nFacts:\n${facts.map((f) => `- ${f.fact}`).join("\n")}`),
		) as { claim?: string; weight?: number }[];
		const claim = out[0]?.claim;
		if (!claim) continue;

		const [page] = await db
			.select({ id: brainPages.id })
			.from(brainPages)
			.where(eq(brainPages.slug, c.entitySlug))
			.limit(1);
		let pageId = page?.id;
		if (!pageId) {
			const [created] = await db
				.insert(brainPages)
				.values({ slug: c.entitySlug, type: "take", title: c.entitySlug })
				.returning({ id: brainPages.id });
			pageId = created.id;
		}
		const [last] = await db
			.select({ rowNum: brainTakes.rowNum })
			.from(brainTakes)
			.where(eq(brainTakes.pageId, pageId))
			.orderBy(desc(brainTakes.rowNum))
			.limit(1);
		await db.insert(brainTakes).values({
			pageId,
			rowNum: (last?.rowNum ?? 0) + 1,
			claim,
			kind: "fact",
			weight: typeof out[0]?.weight === "number" ? Math.min(1, Math.max(0, out[0].weight)) : 0.5,
		});
		// mark the cluster consolidated — pointers keep the audit trail
		const factIds = await db
			.select({ id: brainFacts.id })
			.from(brainFacts)
			.where(and(eq(brainFacts.entitySlug, c.entitySlug), isNull(brainFacts.consolidatedAt)));
		if (factIds.length > 0) {
			await db
				.update(brainFacts)
				.set({ consolidatedAt: new Date(), consolidatedInto: pageId })
				.where(inArray(brainFacts.id, factIds.map((f) => f.id)));
		}
		entities++;
	}
	return { entities };
}

// ── enrich (page body from facts + takes) ──────────────────────────

const ENRICH_SYSTEM = `You write a concise entity brief (max 200 words) for a consulting firm's company brain.
Input: facts and takes. Output ONLY the brief as markdown — who they are, current state, active threads, what to remember before talking to them. No preamble.`;

/** Synthesize compiled_truth for thin entity pages from their facts/takes. */
export async function enrich(opts: { slug?: string } = {}): Promise<{ enriched: number }> {
	const pages = await db
		.select({ id: brainPages.id, slug: brainPages.slug, truth: brainPages.compiledTruth })
		.from(brainPages)
		.where(
			and(
				eq(brainPages.type, "entity"),
				isNull(brainPages.deletedAt),
				opts.slug ? eq(brainPages.slug, opts.slug) : sql`length(${brainPages.compiledTruth}) < 200`,
			),
		)
		.limit(10);

	let enriched = 0;
	for (const p of pages) {
		const facts = await db
			.select({ fact: brainFacts.fact })
			.from(brainFacts)
			.where(and(eq(brainFacts.entitySlug, p.slug), isNull(brainFacts.expiredAt)))
			.orderBy(desc(brainFacts.createdAt))
			.limit(30);
		if (facts.length === 0) continue;
		const takes = await db.select({ claim: brainTakes.claim }).from(brainTakes).where(eq(brainTakes.pageId, p.id));
		const brief = await llm(
			ENRICH_SYSTEM,
			`Facts:\n${facts.map((f) => `- ${f.fact}`).join("\n")}\n\nTakes:\n${takes.map((t) => `- ${t.claim}`).join("\n")}`,
		);
		if (!brief.trim()) continue;
		await db.update(brainPages).set({ compiledTruth: brief }).where(eq(brainPages.id, p.id));
		await rechunkPage(p.id, brief);
		enriched++;
	}
	return { enriched };
}

/** Rebuild the retrieval chunks for a page (call after body changes). */
export async function rechunkPage(pageId: string, body: string) {
	await db.delete(brainChunks).where(eq(brainChunks.pageId, pageId));
	const chunks = chunkText(body);
	if (chunks.length === 0) return;
	await db.insert(brainChunks).values(
		chunks.map((c, i) => ({
			pageId,
			chunkIndex: i,
			chunkText: c,
			tokenCount: Math.ceil(c.length / 4),
		})),
	);
}

// ── cycle orchestrator ─────────────────────────────────────────────

const CYCLE_STALE_MS = 24 * 3600_000;

/** Full brain cycle: deterministic phases, then LLM distillation. */
export async function runCycle(
	opts: { skipLlm?: boolean; reprocessTranscripts?: boolean; slack?: boolean } = {},
): Promise<Record<string, unknown>> {
	const out: Record<string, unknown> = {};
	if (opts.slack) {
		try {
			out.slackSync = await syncSlack();
		} catch (e) {
			out.slackSync = { error: e instanceof Error ? e.message : String(e) };
		}
	}
	out.entities = await syncEntities();
	out.persons = await syncPersons();
	out.prospects = await syncProspects();
	out.loops = await detectLoops();
	out.timeline = await backfillTimeline();
	if (!opts.skipLlm) {
		try {
			out.extract = await extractFacts();
		} catch (e) {
			out.extract = { error: e instanceof Error ? e.message : String(e) };
		}
		try {
			out.lessons = await extractLessons();
		} catch (e) {
			out.lessons = { error: e instanceof Error ? e.message : String(e) };
		}
		try {
			out.transcripts = await extractTranscripts({ reprocess: opts.reprocessTranscripts });
		} catch (e) {
			out.transcripts = { error: e instanceof Error ? e.message : String(e) };
		}
		try {
			out.slackFacts = await extractSlackFacts();
		} catch (e) {
			out.slackFacts = { error: e instanceof Error ? e.message : String(e) };
		}
		try {
			out.consolidate = await consolidate();
		} catch (e) {
			out.consolidate = { error: e instanceof Error ? e.message : String(e) };
		}
		try {
			out.enrich = await enrich();
		} catch (e) {
			out.enrich = { error: e instanceof Error ? e.message : String(e) };
		}
		try {
			out.embed = await embedPending();
		} catch (e) {
			out.embed = { error: e instanceof Error ? e.message : String(e) };
		}
	}
	out.weight = await recomputeWeight();
	await setCursor("last_cycle_at", new Date().toISOString());
	return out;
}

/** Lazy trigger: run the cycle in the background if it's been >24h. */
export async function maybeRunCycle(): Promise<boolean> {
	const last = await getCursor("last_cycle_at");
	if (last && Date.now() - new Date(last).getTime() < CYCLE_STALE_MS) return false;
	void runCycle().catch(() => {});
	return true;
}
