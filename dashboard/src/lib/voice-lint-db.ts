// Voice lint persistence — loads patterns, records overrides/lessons. Split
// from voice-lint.ts (pure core) so a stray client import of the lint core
// can't drag the db chain into the browser bundle.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "~/db";
import { brainFacts, docs, voiceLessonReviews, voicePatterns, voiceLintOverrides } from "~/db/schema";
export type { LintResult, VoiceScope } from "~/lib/voice-lint";
import {
	lintAgainstPatterns,
	normalizePattern,
	patternApplies,
	type LintResult,
	type PatternCandidate,
	type PatternRow,
	type VoiceScope,
} from "~/lib/voice-lint";

let cache: { rows: PatternRow[]; at: number } | null = null;

/** Drop the 60s pattern cache — call after writing patterns. */
export function clearVoiceLintCache() {
	cache = null;
}

async function activePatterns(): Promise<PatternRow[]> {
	if (cache && Date.now() - cache.at < 60_000) return cache.rows;
	const rows = await db
		.select({
			id: voicePatterns.id,
			rule: voicePatterns.rule,
			pattern: voicePatterns.pattern,
			patternType: voicePatterns.patternType,
			direction: voicePatterns.direction,
			beforeText: voicePatterns.beforeText,
			afterText: voicePatterns.afterText,
			surface: voicePatterns.surface,
			genre: voicePatterns.genre,
		})
		.from(voicePatterns)
		.where(eq(voicePatterns.enabled, true));
	cache = { rows: rows.map((r) => ({ ...r, surface: r.surface ?? null, genre: r.genre ?? null })), at: Date.now() };
	return rows;
}

/** Lint text against Collin's voice patterns. avoid matches are violations;
 *  prefer matches are satisfied (reported in checked count only). Pass a scope
 *  to lint only the rules learned for that surface/genre (plus global ones). */
export async function lintVoiceText(text: string, scope?: VoiceScope): Promise<LintResult> {
	const patterns = (await activePatterns()).filter((p) => patternApplies(p, scope));
	const violations = lintAgainstPatterns(text, patterns);
	return { violations, avoidCount: violations.length, checked: patterns.length };
}

/** The hard-gate rejection payload for doc writes: nothing lands, the agent
 *  must rewrite. No agent-side override — a wrong rule gets disabled by
 *  Collin in the dashboard (only the human email send gate has an override). */
export function lintGateError(lint: LintResult) {
	return {
		ok: false as const,
		blocked: "voice_lint" as const,
		violations: lint.violations,
		error: `write REJECTED: ${lint.avoidCount} avoid-violation(s). Rewrite the flagged text and resubmit (verify with lint_voice_text). No override exists — if a rule is wrong, tell Collin to disable it in the dashboard.`,
	};
}

/** The prose half: Collin's voice lessons (brain_facts kind='lesson',
 *  entity 'voice'), highest-signal first — the "read before writing" list. */
export async function getVoiceLessons(limit = 25, scope?: VoiceScope) {
	const rows = await db
		.select({
			id: brainFacts.id,
			fact: brainFacts.fact,
			surface: brainFacts.surface,
			genre: brainFacts.genre,
			confidence: brainFacts.confidence,
		})
		.from(brainFacts)
		.where(and(eq(brainFacts.entitySlug, "voice"), eq(brainFacts.kind, "lesson"), sql`${brainFacts.expiredAt} IS NULL`))
		.orderBy(sql`${brainFacts.confidence} desc`)
		.limit(500);
	return rows.filter((r) => patternApplies(r, scope)).slice(0, limit);
}

/** Genre vocabulary already in use — agents must reuse these before minting
 *  a new one, or scopes fragment ("promo" vs "marketing" lint nothing together). */
export async function listKnownGenres(): Promise<string[]> {
	const [d, f, p] = await Promise.all([
		db.selectDistinct({ genre: docs.genre }).from(docs),
		db.selectDistinct({ genre: brainFacts.genre }).from(brainFacts),
		db.selectDistinct({ genre: voicePatterns.genre }).from(voicePatterns),
	]);
	return [...new Set([...d, ...f, ...p].map((r) => r.genre?.trim().toLowerCase()).filter((g): g is string => Boolean(g)))].sort();
}

/** Insert LLM-proposed patterns from a lesson pair. Duplicates (rule+pattern
 *  unique index) are skipped; cache cleared so the lint sees them at once. */
export async function addVoicePatterns(candidates: PatternCandidate[], lessonText: string, scope?: VoiceScope): Promise<number> {
	let added = 0;
	for (const c of candidates.slice(0, 3)) {
		const p = normalizePattern(c);
		if (!p) continue;
		const res = await db
			.insert(voicePatterns)
			.values({
				...p,
				lessonText: lessonText.slice(0, 500),
				confidence: 0.6,
				enabled: true,
				surface: scope?.surface ?? null,
				genre: scope?.genre?.trim().toLowerCase() || null,
			})
			.onConflictDoNothing({ target: [voicePatterns.rule, voicePatterns.pattern] })
			.returning({ id: voicePatterns.id });
		if (res.length) added++;
	}
	if (added) clearVoiceLintCache();
	return added;
}

/** Human sent a draft despite its violations — record which patterns were
 *  overridden. That's the long-term signal for which rules are too strict. */
export async function recordLintOverrides(patternIds: string[], outboxId?: string) {
	if (!patternIds.length) return;
	await db.insert(voiceLintOverrides).values(patternIds.map((patternId) => ({ patternId, outboxId: outboxId ?? null })));
	await db
		.update(voicePatterns)
		.set({ overrideCount: sql`${voicePatterns.overrideCount} + 1` })
		.where(inArray(voicePatterns.id, patternIds));
}

// ── Lessons review gate ────────────────────────────────────────────
// Server-side proof an agent chat actually pulled the lessons: doc writes
// are rejected without a review no older than LESSON_REVIEW_TTL_MS.
const LESSON_REVIEW_TTL_MS = 60 * 60 * 1000;

export async function recordLessonReview(chatUuid: string) {
	await db
		.insert(voiceLessonReviews)
		.values({ chatUuid })
		.onConflictDoUpdate({ target: voiceLessonReviews.chatUuid, set: { reviewedAt: new Date() } });
}

export async function hasRecentLessonReview(chatUuid: string): Promise<boolean> {
	const [row] = await db
		.select({ at: voiceLessonReviews.reviewedAt })
		.from(voiceLessonReviews)
		.where(eq(voiceLessonReviews.chatUuid, chatUuid))
		.limit(1);
	return !!row && Date.now() - row.at.getTime() < LESSON_REVIEW_TTL_MS;
}
