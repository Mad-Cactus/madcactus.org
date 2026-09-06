/** Brain /activity `tools` normalization — koola/flora/mo brains changed
 * return shape over time (string[] vs {tool, c}[]); the outreach board must
 * render either without leaking "[object Object]". */

export function normalizeBrainTools(v: unknown): string[] {
	if (!Array.isArray(v)) return [];
	return v.map((t) => {
		if (typeof t === "string") return t;
		if (t && typeof t === "object" && "tool" in t) {
			const o = t as { tool?: unknown; c?: unknown };
			const name = typeof o.tool === "string" ? o.tool : String(o.tool ?? "");
			return typeof o.c === "number" && o.c > 1 ? `${name}×${o.c}` : name;
		}
		return String(t);
	});
}
