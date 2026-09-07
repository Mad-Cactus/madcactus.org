// Voice lint persistence — loads patterns, records overrides/lessons. Split
// from voice-lint.ts (pure core) so a stray client import of the lint core
// can't drag the db chain into the browser bundle.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "~/db";
import { brainFacts, voicePatterns, voiceLintOverrides } from "~/db/schema";
import {
	lintAgainstPatterns,
	normalizePattern,
	type LintResult,
	type PatternCandidate,
	type PatternRow,
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
		})
		.from(voicePatterns)
		.where(eq(voicePatterns.enabled, true));
	cache = { rows, at: Date.now() };
	return rows;
}

/** Lint text against Collin's voice patterns. avoid matches are violations;
 *  prefer matches are satisfied (reported in checked count only). */
export async function lintVoiceText(text: string): Promise<LintResult> {
	const patterns = await activePatterns();
	const violations = lintAgainstPatterns(text, patterns);
	return { violations, avoidCount: violations.length, checked: patterns.length };
}

/** The prose half: Collin's voice lessons (brain_facts kind='lesson',
 *  entity 'voice'), highest-signal first — the "read before writing" list. */
export async function getVoiceLessons(limit = 25) {
	return db
		.select({ id: brainFacts.id, fact: brainFacts.fact, surface: brainFacts.surface, confidence: brainFacts.confidence })
		.from(brainFacts)
		.where(and(eq(brainFacts.entitySlug, "voice"), eq(brainFacts.kind, "lesson"), sql`${brainFacts.expiredAt} IS NULL`))
		.orderBy(sql`${brainFacts.confidence} desc`)
		.limit(limit);
}

/** Insert LLM-proposed patterns from a lesson pair. Duplicates (rule+pattern
 *  unique index) are skipped; cache cleared so the lint sees them at once. */
export async function addVoicePatterns(candidates: PatternCandidate[], lessonText: string): Promise<number> {
	let added = 0;
	for (const c of candidates.slice(0, 3)) {
		const p = normalizePattern(c);
		if (!p) continue;
		const res = await db
			.insert(voicePatterns)
			.values({ ...p, lessonText: lessonText.slice(0, 500), confidence: 0.6, enabled: true })
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
