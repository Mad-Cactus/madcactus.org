// Voice lint — the machine-checkable half of the voice system. Patterns
// (voice_patterns table, seeded from derived agent-draft -> human-edit rules)
// run against text before agents land it; violations go back to the agent so
// it self-corrects, and the email send gate blocks un-fixed avoid-violations.
// The prose half (lessons) lives in brain_facts (kind='lesson').
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "~/db";
import { brainFacts, voicePatterns, voiceLintOverrides } from "~/db/schema";

export type LintViolation = {
	patternId: string;
	rule: string;
	direction: "avoid" | "prefer";
	patternType: string;
	matched: string;
	before: string | null;
	after: string | null;
};

export type LintResult = {
	violations: LintViolation[];
	avoidCount: number;
	checked: number;
};

export type PatternRow = {
	id: string;
	rule: string;
	pattern: string;
	patternType: string;
	direction: string;
	beforeText: string | null;
	afterText: string | null;
};

let cache: { rows: PatternRow[]; at: number } | null = null;

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

export function clearVoiceLintCache() {
	cache = null;
}

/** Pure core — the DB wrapper below just feeds it enabled patterns. */
export function lintAgainstPatterns(text: string, patterns: PatternRow[]): LintViolation[] {
	const violations: LintViolation[] = [];
	for (const p of patterns) {
		const matched = matchPattern(p, text);
		if (!matched) continue;
		if (p.direction === "avoid") {
			violations.push({
				patternId: p.id,
				rule: p.rule,
				direction: "avoid",
				patternType: p.patternType,
				matched,
				before: p.beforeText,
				after: p.afterText,
			});
		}
	}
	return violations;
}

/** One violation check per pattern: literal = case-insensitive substring,
 *  regex = JS regex (case-insensitive; broken patterns are skipped, not fatal). */
function matchPattern(p: PatternRow, text: string): string | null {
	try {
		if (p.patternType === "regex") {
			const re = new RegExp(p.pattern, "i");
			const m = re.exec(text);
			return m ? m[0] : null;
		}
		const idx = text.toLowerCase().indexOf(p.pattern.toLowerCase());
		return idx === -1 ? null : text.slice(idx, idx + p.pattern.length);
	} catch {
		return null; // broken stored regex — skip, never break writes on it
	}
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
		.orderBy(descConfidence())
		.limit(limit);
}

function descConfidence() {
	return sql`${brainFacts.confidence} desc`;
}

export type PatternCandidate = {
	rule: string;
	pattern: string;
	type?: string;
	direction?: string;
	before?: string;
	after?: string;
};

/** Validate + normalize an LLM-proposed pattern. Returns null when unusable
 *  (empty, unknown type/direction, or a regex that doesn't compile). */
export function normalizePattern(c: PatternCandidate): Omit<PatternRow, "id"> | null {
	const rule = (c.rule ?? "").trim();
	const pattern = (c.pattern ?? "").trim();
	const type = c.type === "regex" ? "regex" : "literal";
	const direction = c.direction === "prefer" ? "prefer" : "avoid";
	if (!rule || !pattern || rule.length > 300 || pattern.length > 300) return null;
	if (type === "regex") {
		try {
			new RegExp(pattern, "i");
		} catch {
			return null;
		}
	}
	return {
		rule,
		pattern,
		patternType: type,
		direction,
		beforeText: c.before?.slice(0, 500) ?? null,
		afterText: c.after?.slice(0, 500) ?? null,
	};
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
