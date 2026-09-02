// Redline engine — Postgres port of ~/GitHub/redline/src/lib.rs.
// Draft → human edits → pair → lessons learning loop. The derivation itself
// runs in a LOCAL sidecar (it needs ~/.pi transcripts); this module owns the
// data: drafts, revisions, pairs, lessons, patterns, derivation jobs.
import { and, desc, eq, isNull, or, ilike, sql } from "drizzle-orm";
import { diffWordsWithSpace, createPatch } from "diff";
import { db } from "~/db";
import {
	redlineDrafts,
	redlineRevisions,
	redlinePairs,
	redlineLessons,
	redlinePatterns,
	redlineDerivationJobs,
	type RedlinePattern,
} from "~/db/schema";

// ── Diffing ────────────────────────────────────────────────────────

export type WordPart = { value: string; added?: boolean; removed?: boolean };

/** GitHub-style word-level parts (UI highlighting). */
export function wordDiff(oldStr: string, newStr: string): WordPart[] {
	return diffWordsWithSpace(oldStr, newStr);
}

/** Plain unified diff text (stored on pairs, returned over MCP). */
export function unifiedDiff(oldStr: string, newStr: string): string {
	return createPatch("content", oldStr, newStr, "draft", "final");
}

// ── Lint (the write gate) ──────────────────────────────────────────
// Port of redline's lint_draft: "avoid" patterns that match → violations;
// "prefer" patterns that are absent → suggestions. Literal = case-insensitive.

export type Violation = {
	patternId: string;
	lessonId: string | null;
	rule: string;
	category: string;
	direction: "avoid" | "prefer";
	matchedText: string;
	context: string;
	line: number;
};

function lineAt(content: string, idx: number): number {
	let line = 1;
	for (let i = 0; i < idx; i++) if (content[i] === "\n") line++;
	return line;
}

function findMatches(content: string, pat: RedlinePattern): { text: string; index: number }[] {
	if (pat.patternType === "regex") {
		try {
			const re = new RegExp(pat.pattern, "g");
			const out: { text: string; index: number }[] = [];
			for (let m = re.exec(content); m; m = re.exec(content)) {
				out.push({ text: m[0], index: m.index });
				if (m[0] === "") re.lastIndex++; // zero-width guard
			}
			return out;
		} catch {
			return []; // skip invalid regex, same as redline
		}
	}
	const lower = content.toLowerCase();
	const needle = pat.pattern.toLowerCase();
	const out: { text: string; index: number }[] = [];
	let idx = lower.indexOf(needle);
	while (idx !== -1) {
		out.push({ text: content.slice(idx, idx + pat.pattern.length), index: idx });
		idx = lower.indexOf(needle, idx + needle.length);
	}
	return out;
}

export function lintContent(content: string, patterns: RedlinePattern[]): Violation[] {
	const violations: Violation[] = [];
	for (const pat of patterns) {
		const matches = findMatches(content, pat);
		if (pat.direction === "prefer") {
			if (matches.length === 0) {
				violations.push({
					patternId: pat.id,
					lessonId: pat.lessonId,
					rule: pat.rule,
					category: pat.category,
					direction: "prefer",
					matchedText: "",
					context: `consider using: ${pat.pattern}`,
					line: 0,
				});
			}
			continue;
		}
		for (const m of matches) {
			// ponytail: 40-char context window each side, same as redline
			const start = Math.max(0, m.index - 40);
			const end = Math.min(content.length, m.index + m.text.length + 40);
			violations.push({
				patternId: pat.id,
				lessonId: pat.lessonId,
				rule: pat.rule,
				category: pat.category,
				direction: "avoid",
				matchedText: m.text,
				context: content.slice(start, end).replace(/\n/g, " "),
				line: lineAt(content, m.index),
			});
		}
	}
	return violations;
}

/** The gate rule: any "avoid" violation blocks the write. */
export function shouldBlock(violations: Violation[]): boolean {
	return violations.some((v) => v.direction === "avoid");
}

// ── Drafts ─────────────────────────────────────────────────────────

export type CreateDraftInput = {
	content: string;
	title?: string;
	context?: string;
	tags?: string;
	chatUuid?: string;
	surface?: "manual" | "doc" | "email";
	source?: "agent" | "human";
};

export async function createDraft(input: CreateDraftInput) {
	const [draft] = await db
		.insert(redlineDrafts)
		.values({
			title: input.title ?? "",
			context: input.context,
			tags: input.tags,
			chatUuid: input.chatUuid,
			surface: input.surface ?? "manual",
			source: input.source ?? "agent",
			currentContent: input.content,
		})
		.returning();
	await db.insert(redlineRevisions).values({
		draftId: draft.id,
		content: input.content,
		author: input.source ?? "agent",
	});
	return draft;
}

export async function getDraft(id: string) {
	const [draft] = await db.select().from(redlineDrafts).where(eq(redlineDrafts.id, id));
	if (!draft) return null;
	const revisions = await db
		.select()
		.from(redlineRevisions)
		.where(eq(redlineRevisions.draftId, id))
		.orderBy(redlineRevisions.createdAt);
	return { draft, revisions };
}

export async function listDrafts(all = false) {
	const where = all ? undefined : eq(redlineDrafts.status, "open");
	return db
		.select()
		.from(redlineDrafts)
		.where(where)
		.orderBy(desc(redlineDrafts.updatedAt))
		.limit(100);
}

export async function saveRevision(
	draftId: string,
	content: string,
	author: "agent" | "human",
	chatUuid?: string,
) {
	const [draft] = await db.select().from(redlineDrafts).where(eq(redlineDrafts.id, draftId));
	if (!draft) throw new Error(`draft not found: ${draftId}`);
	await db.insert(redlineRevisions).values({ draftId, content, author });
	await db
		.update(redlineDrafts)
		.set({ currentContent: content, ...(chatUuid ? { chatUuid } : {}) })
		.where(eq(redlineDrafts.id, draftId));
}

export async function restoreRevision(draftId: string, revisionId: string) {
	const [rev] = await db
		.select()
		.from(redlineRevisions)
		.where(and(eq(redlineRevisions.id, revisionId), eq(redlineRevisions.draftId, draftId)));
	if (!rev) throw new Error(`revision not found: ${revisionId}`);
	// restore = append a new revision copying the old one; history never destroyed
	await saveRevision(draftId, rev.content, "human");
}

export async function deleteDraft(id: string) {
	// keep any finalized pair — only the draft goes
	await db
		.update(redlineDrafts)
		.set({ status: "deleted" })
		.where(and(eq(redlineDrafts.id, id), eq(redlineDrafts.status, "open")));
}

// ── Finalize → pair ────────────────────────────────────────────────

export async function finalizeDraft(draftId: string) {
	const got = await getDraft(draftId);
	if (!got) throw new Error(`draft not found: ${draftId}`);
	const { draft, revisions } = got;
	if (draft.status === "finalized") return draft.pairId!;
	if (revisions.length === 0) throw new Error("draft has no revisions");

	const draftContent = revisions[0].content; // agent's original
	const finalContent = revisions[revisions.length - 1].content; // human's final
	const pair = (
		await db
			.insert(redlinePairs)
			.values({
				draftId,
				surface: draft.surface,
				context: draft.context,
				tags: draft.tags,
				chatUuid: draft.chatUuid,
				draftContent,
				finalContent,
				diffText: unifiedDiff(draftContent, finalContent),
			})
			.returning()
	)[0];

	await db
		.update(redlineDrafts)
		.set({ status: "finalized", pairId: pair.id })
		.where(eq(redlineDrafts.id, draftId));

	// idempotent enqueue — the sidecar derives lessons for pending jobs
	await db
		.insert(redlineDerivationJobs)
		.values({ pairId: pair.id })
		.onConflictDoNothing();

	return pair.id;
}

/** Direct pair ingest (no draft round-trip): agent already has draft+final. */
export async function addPair(input: {
	draftContent: string;
	finalContent: string;
	context?: string;
	tags?: string;
	chatUuid?: string;
	surface?: "manual" | "doc" | "email";
}) {
	const pair = (
		await db
			.insert(redlinePairs)
			.values({
				draftContent: input.draftContent,
				finalContent: input.finalContent,
				context: input.context,
				tags: input.tags,
				chatUuid: input.chatUuid,
				surface: input.surface ?? "manual",
				diffText: unifiedDiff(input.draftContent, input.finalContent),
			})
			.returning()
	)[0];
	await db.insert(redlineDerivationJobs).values({ pairId: pair.id }).onConflictDoNothing();
	return pair;
}

// ── Pairs / lessons / patterns ─────────────────────────────────────

export async function showPair(id: string) {
	const [pair] = await db.select().from(redlinePairs).where(eq(redlinePairs.id, id));
	return pair ?? null;
}

export async function recentPairs(limit = 20) {
	return db.select().from(redlinePairs).orderBy(desc(redlinePairs.createdAt)).limit(limit);
}

export async function addLesson(input: {
	pairId?: string;
	lesson: string;
	tags?: string;
}) {
	const [row] = await db
		.insert(redlineLessons)
		.values({ pairId: input.pairId, lesson: input.lesson, tags: input.tags })
		.returning();
	return row;
}

export async function listLessons(tags?: string) {
	const rows = await db
		.select()
		.from(redlineLessons)
		.orderBy(desc(redlineLessons.createdAt))
		.limit(200);
	if (!tags) return rows;
	const wanted = tags.split(",").map((t) => t.trim().toLowerCase());
	return rows.filter((r) => {
		const have = (r.tags ?? "").split(",").map((t) => t.trim().toLowerCase());
		return wanted.some((w) => have.includes(w));
	});
}

export type AddPatternInput = {
	lessonId?: string;
	rule: string;
	pattern: string;
	patternType?: "literal" | "regex";
	direction?: "avoid" | "prefer";
	category?: string;
	beforeText?: string;
	afterText?: string;
};

export async function addPattern(input: AddPatternInput) {
	const [row] = await db
		.insert(redlinePatterns)
		.values({
			lessonId: input.lessonId,
			rule: input.rule,
			pattern: input.pattern,
			patternType: input.patternType ?? "literal",
			direction: input.direction ?? "avoid",
			category: input.category ?? "style",
			beforeText: input.beforeText,
			afterText: input.afterText,
		})
		.returning();
	return row;
}

export async function listPatterns() {
	return db.select().from(redlinePatterns).orderBy(desc(redlinePatterns.createdAt));
}

/** Full gate: lint `content` against every stored pattern. */
export async function lintDraft(content: string) {
	return lintContent(content, await listPatterns());
}

export async function search(query: string) {
	const needle = `%${query}%`;
	const [drafts, pairs, lessons] = await Promise.all([
		db
			.select()
			.from(redlineDrafts)
			.where(or(ilike(redlineDrafts.currentContent, needle), ilike(redlineDrafts.title, needle)))
			.limit(20),
		db
			.select()
			.from(redlinePairs)
			.where(
				or(
					ilike(redlinePairs.draftContent, needle),
					ilike(redlinePairs.finalContent, needle),
					ilike(redlinePairs.context, needle),
				),
			)
			.limit(20),
		db.select().from(redlineLessons).where(ilike(redlineLessons.lesson, needle)).limit(20),
	]);
	return { drafts, pairs, lessons };
}

// ── Pattern promotion (occurrence-based confidence) ────────────────
// Unconfirmed → confirmed when an avoid pattern appeared in 3+ pairs' drafts.

export async function promotePatterns() {
	const patterns = await listPatterns();
	const promoted: { id: string; rule: string; count: number }[] = [];
	for (const pat of patterns) {
		if (pat.confidence === "confirmed") continue;
		const [{ count }] = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(redlinePairs)
			.where(
				pat.direction === "avoid"
					? ilike(redlinePairs.draftContent, `%${pat.pattern}%`)
					: ilike(redlinePairs.finalContent, `%${pat.pattern}%`),
			);
		if (count >= 3) {
			await db
				.update(redlinePatterns)
				.set({ confidence: "confirmed" })
				.where(eq(redlinePatterns.id, pat.id));
			promoted.push({ id: pat.id, rule: pat.rule, count });
		}
	}
	return promoted;
}

// ── Derivation queue (consumed by the LOCAL sidecar) ───────────────
// The sidecar runs on Collin's Mac (it reads ~/.pi transcripts) and talks to
// the dashboard over MCP: list_derivation_jobs → derive → add_lesson/...
// → complete_derivation_job.

export async function pendingDerivationJobs(limit = 10) {
	return db
		.select({
			jobId: redlineDerivationJobs.id,
			pairId: redlinePairs.id,
			draftContent: redlinePairs.draftContent,
			finalContent: redlinePairs.finalContent,
			diffText: redlinePairs.diffText,
			context: redlinePairs.context,
			surface: redlinePairs.surface,
			chatUuid: redlinePairs.chatUuid,
			draftId: redlinePairs.draftId,
		})
		.from(redlineDerivationJobs)
		.innerJoin(redlinePairs, eq(redlineDerivationJobs.pairId, redlinePairs.id))
		.where(eq(redlineDerivationJobs.status, "pending"))
		.orderBy(redlineDerivationJobs.createdAt)
		.limit(limit);
}

export async function markDerivationJob(
	jobId: string,
	status: "processing" | "done" | "failed",
	error?: string,
) {
	await db
		.update(redlineDerivationJobs)
		.set({
			status,
			error: error ?? null,
			attempts: status === "failed" ? sql`${redlineDerivationJobs.attempts} + 1` : undefined,
		})
		.where(eq(redlineDerivationJobs.id, jobId));
}
