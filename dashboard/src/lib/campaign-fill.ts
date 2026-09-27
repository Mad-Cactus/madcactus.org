// Template fill for campaign touches — pure, isomorphic (used by the admin
// preview, safe in the client bundle). Unknown slots stay visible as
// {{slot}} so a preview shows exactly what is missing instead of faking it.

export type FillValues = Record<string, string>;

/** Replace {{slot}} tokens in a touch subject/body. */
export function fillTemplate(text: string, values: FillValues): string {
	return text.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (whole, name: string) => {
		const v = values[name.toLowerCase()];
		return v === undefined ? whole : v;
	});
}

/** All distinct slot names a template uses, lowercase, in order of first use. */
export function templateSlots(text: string): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)) {
		const name = m[1].toLowerCase();
		if (!out.includes(name)) out.push(name);
	}
	return out;
}
