// Prospeo company enrichment — the headcount + revenue driver.
// Why Prospeo over Apollo here: 1 credit per MATCHED company, 0 credits on
// no-match (our queue is mostly misses = free screening), and one call
// returns employee_count + revenue_range + founded + location.
// Docs: https://prospeo.io/api-docs/enrich-company
import { cleanName } from "./enrich-apollo";

export function prospeoConfigured() {
	return Boolean(process.env.PROSPEO_API_KEY);
}

export type ProspeoCompany = {
	employeeCount: number | null;
	employeeRange: string | null;
	revenueMin: number | null;
	revenueMax: number | null;
	founded: number | null;
	city: string | null;
	state: string | null;
	domain: string | null;
	linkedinUrl: string | null;
	industry: string | null;
};

/** Enrich by company name. null = no match (costs 0 credits). */
export async function prospeoEnrichCompany(companyName: string): Promise<ProspeoCompany | null> {
	const r = await fetch("https://api.prospeo.io/enrich-company", {
		method: "POST",
		headers: { "Content-Type": "application/json", "X-KEY": process.env.PROSPEO_API_KEY! },
		body: JSON.stringify({ data: { company_name: cleanName(companyName) } }),
	});
	if (r.status === 400) {
		const d = (await r.json().catch(() => ({}))) as { error_code?: string };
		if (d.error_code === "NO_MATCH") return null;
		throw new Error(`prospeo: ${d.error_code ?? "bad request"}`);
	}
	if (!r.ok) throw new Error(`prospeo enrich HTTP ${r.status}`);
	const d = (await r.json()) as { company?: Record<string, unknown> };
	const c = d.company ?? {};
	const range = (c.employee_range as string | null) ?? null;
	const rev = (c.revenue_range as { min?: number; max?: number } | null) ?? {};
	const loc = (c.location as { city?: string; state?: string } | null) ?? {};
	return {
		employeeCount: typeof c.employee_count === "number" ? c.employee_count : null,
		employeeRange: range,
		revenueMin: typeof rev.min === "number" ? rev.min : null,
		revenueMax: typeof rev.max === "number" ? rev.max : null,
		founded: typeof c.founded === "number" ? c.founded : null,
		city: loc.city ?? null,
		state: loc.state ?? null,
		domain: typeof c.domain === "string" ? c.domain : null,
		linkedinUrl: typeof c.linkedin_url === "string" ? c.linkedin_url : null,
		industry: typeof c.industry === "string" ? c.industry : null,
	};
}

/** "11-50" → 30 (midpoint). Falls back when employee_count is null. */
export function rangeMidpoint(range: string | null): number | null {
	const m = range?.match(/(\d+)[^\d]+(\d+)/);
	return m ? Math.round((Number(m[1]) + Number(m[2])) / 2) : null;
}
