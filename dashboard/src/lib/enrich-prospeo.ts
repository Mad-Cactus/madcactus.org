// Prospeo company enrichment — the headcount + revenue driver.
// Why Prospeo over Apollo here: 1 credit per MATCHED company, 0 credits on
// no-match (our queue is mostly misses = free screening), and one call
// returns employee_count + revenue_range + founded + location.
// Docs: https://prospeo.io/api-docs/enrich-company
import { cleanName } from "./enrich-apollo";

// Prospeo rate-limits per minute (429) — space calls out and back off on 429.
const MIN_INTERVAL = 4000;
let lastCall = 0;
async function throttle() {
	const wait = MIN_INTERVAL - (Date.now() - lastCall);
	if (wait > 0) await Bun.sleep(wait);
	lastCall = Date.now();
}

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

function mapCompany(c: Record<string, unknown>): ProspeoCompany {
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

/** Bulk: up to 50 companies in ONE request (1 credit per match, 0 on miss,
 *  one rate-limit slot instead of 50). Map value null = not matched. */
export async function prospeoBulkEnrich(companyNames: string[]): Promise<Map<string, ProspeoCompany | null>> {
	const out = new Map<string, ProspeoCompany | null>();
	if (companyNames.length === 0) return out;
	for (let attempt = 0; ; attempt++) {
		await throttle();
		const r = await fetch("https://api.prospeo.io/bulk-enrich-company", {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-KEY": process.env.PROSPEO_API_KEY! },
			body: JSON.stringify({ data: companyNames.map((n, i) => ({ identifier: String(i), company_name: cleanName(n) })) }),
		});
		if (r.status === 429 && attempt < 3) {
			await Bun.sleep(30_000 * (attempt + 1));
			continue;
		}
		const body = await r.text();
		if (!r.ok) throw new Error(`prospeo bulk HTTP ${r.status} (rate-limited? retry in a minute): ${body.slice(0, 120)}`);
		const d = JSON.parse(body) as { matched?: { identifier: string; company?: Record<string, unknown> }[] };
		const byIdx = new Map<string, ProspeoCompany>();
		for (const m of d.matched ?? []) if (m.company) byIdx.set(m.identifier, mapCompany(m.company));
		companyNames.forEach((n, i) => out.set(n, byIdx.get(String(i)) ?? null));
		return out;
	}
}

/** Enrich by company name. null = no match (costs 0 credits). */
export async function prospeoEnrichCompany(companyName: string): Promise<ProspeoCompany | null> {
	let body = "";
	for (let attempt = 0; ; attempt++) {
		await throttle();
		const r = await fetch("https://api.prospeo.io/enrich-company", {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-KEY": process.env.PROSPEO_API_KEY! },
			body: JSON.stringify({ data: { company_name: cleanName(companyName) } }),
		});
		if (r.status === 429 && attempt < 4) {
			await Bun.sleep(15_000 * (attempt + 1));
			continue;
		}
		body = await r.text();
		if (r.status === 400) {
			const d = JSON.parse(body || "{}") as { error_code?: string };
			if (d.error_code === "NO_MATCH") return null;
			throw new Error(`prospeo: ${d.error_code ?? "bad request"}`);
		}
		if (!r.ok) throw new Error(`prospeo enrich HTTP ${r.status}: ${body.slice(0, 120)}`);
		break;
	}
	const d = JSON.parse(body) as { company?: Record<string, unknown> };
	return d.company ? mapCompany(d.company) : null;
}

/** "11-50" → 30 (midpoint). Falls back when employee_count is null. */
export function rangeMidpoint(range: string | null): number | null {
	const m = range?.match(/(\d+)[^\d]+(\d+)/);
	return m ? Math.round((Number(m[1]) + Number(m[2])) / 2) : null;
}
