// Voice lint core — the machine-checkable half of the voice system, and
// deliberately PURE: no db, no node builtins, safe to import from client code.
// Pattern persistence lives in voice-lint-db.ts (server-only). Patterns are
// seeded from derived agent-draft -> human-edit rules; violations go back to
// the agent so it self-corrects, and the email send gate blocks un-fixed
// avoid-violations. The prose half (lessons) lives in brain_facts (kind='lesson').

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

/** Pure core — the DB wrapper just feeds it enabled patterns. */
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
