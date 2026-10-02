// AI-signal scoring — pure functions, no IO. The locked promotion rule (see
// ICP.md): an employee who self-labels AI on LinkedIn is the ONLY promotion
// signal, any role — a small technical team using AI is the good case, not a
// disqualifier. The website scan corroborates only (upgrades some→high); a
// vendor hint (brand-matched .ai product domain, AI-product marketing) is
// note-only intelligence and never changes a verdict.
import type { ProspeoPerson } from "./enrich-prospeo";

// Case-sensitive token on purpose: "AIR", "said", "Kai" must never match.
// Every other term goes through the case-insensitive phrases regex.
export const AI_TOKEN = /\bAI\b/;
export const AI_PHRASES =
	/\b(artificial intelligence|machine learning|chatgpt|copilot|gen[\s-]?ai|AI[\s-]?(?:powered|driven|enabled))\b/i;

export function aiHit(text: string): boolean {
	return AI_TOKEN.test(text) || AI_PHRASES.test(text);
}

export type AiMatch = { name: string; title: string | null; evidence: string };

/** People whose headline or current title self-labels AI, with role verbatim
 *  for slot-time eyeballing. Capped at 3 examples — ≥1 is the rule; the full
 *  roster stays cached on the item. */
export function scoreRoster(people: ProspeoPerson[]): AiMatch[] {
	const out: AiMatch[] = [];
	for (const p of people) {
		const inHeadline = p.headline ? aiHit(p.headline) : false;
		const inTitle = p.title ? aiHit(p.title) : false;
		if (!inHeadline && !inTitle) continue;
		const source = inHeadline ? `headline: ${p.headline}` : `title: ${p.title}`;
		out.push({ name: p.name, title: p.title, evidence: `${p.name} — ${p.title ?? "role n/a"} (${source})` });
	}
	return out.slice(0, 3);
}

// ponytail: fixed widget list — covers the chat vendors this ICP actually
// shows up with; extend when a new vendor class appears in rescue notes.
const WIDGET_RE = /(intercom|drift\.io|livechat|tidio|crisp\.chat|chatbase|voiceflow|botpress|tawk\.to|freshchat|hubspot.*conversations)/i;
// brand-matched outbound .ai links ("finemark.ai") — the vendor-hint signal
const AI_DOMAIN_RE = /href=["']https?:\/\/([a-z0-9.-]+\.ai)(\/|["'])/gi;
const GENERIC_TOKENS = new Set([
	"inc", "llc", "the", "and", "co", "corp", "company", "logistics", "freight",
	"transport", "transportation", "trucking", "express", "services", "group", "inc.",
]);

/** Brand tokens of a company name: split on non-alphanumerics, drop short and
 *  generic freight words. "FINEMARK INC" → ["finemark"]. */
export function brandTokens(companyName: string): string[] {
	return companyName
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length >= 3 && !GENERIC_TOKENS.has(t));
}

export type SiteScan = {
	/** Matched AI terms; weak ones are prefixed (POLICY:, widget:) and never corroborate. */
	evidence: string[];
	/** Note-only vendor hints: brand .ai domains + brand-AI marketing. */
	vendorHints: string[];
};

/** Corroborator ported from the validated study scanner. Strips <script> AND
 *  <style> (the Wix `--wbu-color-ai-0` trap lives in CSS). Privacy-page and
 *  widget hits are tagged weak — they feed the manual-rescue note, never the
 *  tier-1 upgrade. Non-brand-matched .ai links (glydr.ai directory embeds)
 *  are noise and ignored. */
export function scanSite(html: string, url: string, companyName: string): SiteScan {
	const isPrivacy = /privacy/i.test(url);
	const stripped = html
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ");

	const evidence: string[] = [];
	if (!isPrivacy) {
		if (AI_TOKEN.test(stripped)) evidence.push("ai");
		for (const m of stripped.matchAll(new RegExp(AI_PHRASES.source, "gi"))) {
			const label = m[1].toLowerCase().replace(/\s+/g, " ");
			if (!evidence.includes(label)) evidence.push(label);
		}
		const widget = html.match(WIDGET_RE)?.[1];
		if (widget) evidence.push(`widget:${widget.toLowerCase()}`);
	} else {
		for (const m of stripped.matchAll(new RegExp(AI_PHRASES.source, "gi"))) {
			const label = `POLICY:${m[1].toLowerCase().replace(/\s+/g, " ")}`;
			if (!evidence.includes(label)) evidence.push(label);
		}
		if (AI_TOKEN.test(stripped) && !evidence.some((e) => e === "POLICY:ai"))
			evidence.push("POLICY:ai");
	}

	// vendor hints — reported, never scored
	const vendorHints: string[] = [];
	const tokens = brandTokens(companyName);
	for (const m of stripped.matchAll(AI_DOMAIN_RE)) {
		const stem = m[1].slice(0, -3); // drop ".ai"
		if (tokens.some((t) => stem.includes(t)) && !vendorHints.includes(m[1])) vendorHints.push(m[1]);
	}
	for (const t of tokens) {
		if (new RegExp(`${t}[\\s-]*\\bAI\\b`, "i").test(stripped)) {
			const hint = `${t} ai (marketing)`;
			if (!vendorHints.includes(hint)) vendorHints.push(hint);
		}
	}
	if (/\bour AI (platform|product|assistant)/i.test(stripped) && !vendorHints.includes("our AI platform"))
		vendorHints.push("our AI platform");

	return { evidence, vendorHints };
}

export type TierInput = {
	employeeMatches: AiMatch[];
	siteEvidence: string[]; // merged evidence across pages (weak tags included)
	vendorHints: string[];
	rosterTotal: number; // Prospeo's total_count (pagination-aware)
	rosterPeople: number; // people actually on the cached page (≤25)
	siteAttempted: boolean; // had a domain and fetched pages
};
export type TierResult = {
	tier: 1 | 2 | 3 | 4;
	verdict: "pass" | "fail";
	aiInterest: "high" | "some" | null;
	note: string;
};

/** The locked promotion table + the stage note. Vendor hints never change a
 *  verdict — they ride in the note for slot-time judgment. Note format:
 *  `tier{n}|<evidence>[; vendor-hint: <hints>]`, ≤300 chars; the tier prefix
 *  maps to aiInterest in applyVerdictConsequences (tier1→high, tier2→some). */
export function scoreAiSignal(input: TierInput): TierResult {
	// weak evidence (POLICY:, widget:) never corroborates — rescue note only
	const strong = input.siteEvidence.some((e) => !e.startsWith("POLICY:") && !e.startsWith("widget:"));
	let tier: 1 | 2 | 3 | 4;
	let verdict: "pass" | "fail";
	let aiInterest: "high" | "some" | null = null;
	if (input.employeeMatches.length >= 1 && strong) {
		tier = 1;
		verdict = "pass";
		aiInterest = "high";
	} else if (input.employeeMatches.length >= 1) {
		tier = 2;
		verdict = "pass";
		aiInterest = "some";
	} else if (input.siteEvidence.length >= 1) {
		tier = 2;
		verdict = "fail"; // site-only evidence — note for manual rescue
	} else if (input.rosterTotal > 0 || input.siteAttempted) {
		tier = 3;
		verdict = "fail";
	} else {
		tier = 4;
		verdict = "fail"; // barely have a phone
	}

	const parts = input.employeeMatches.map((m) => m.evidence);
	if (input.rosterTotal > 25) parts.push(`roster: ${input.rosterTotal}>25`);
	if (input.siteEvidence.length) parts.push(`site: ${[...new Set(input.siteEvidence)].join(",")}`);
	if (!parts.length)
		parts.push(`roster ${input.rosterPeople}, zero AI signal${input.siteAttempted ? "" : ", no site"}`);
	const hints = [...new Set(input.vendorHints)].join("; ");
	const note = `tier${tier}|${parts.join("; ")}${hints ? `; vendor-hint: ${hints}` : ""}`;
	return { tier, verdict, aiInterest, note: note.slice(0, 300) };
}
