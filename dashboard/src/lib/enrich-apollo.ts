// Apollo enrichment for funnel api-stages (headcount, tech_team).
// Reads APOLLO_API_KEY. The key must be scoped for: mixed_companies/search,
// organizations/enrich, and mixed_people/search (Apollo scopes per endpoint
// in the API key editor). Absent key → apolloConfigured() false and the
// "Run stage" button reports the driver unconfigured.
// Docs: https://docs.apollo.io
const API = "https://api.apollo.io/v1";

export function apolloConfigured() {
	return Boolean(process.env.APOLLO_API_KEY);
}

async function apolloPost(path: string, body: Record<string, unknown>) {
	const r = await fetch(`${API}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json", "X-Api-Key": process.env.APOLLO_API_KEY! },
		body: JSON.stringify(body),
	});
	if (!r.ok) throw new Error(`apollo ${path} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
	return (await r.json()) as Record<string, unknown>;
}

/** Strip legal suffixes — "10-4 GLOBAL LLC" finds nothing, "10-4 Global" does. */
export const cleanName = (n: string) => n.replace(/\s+(LLC|L\.L\.C|INC|INC\.|CORP|CORPORATION|LTD|CO\.)\s*$/i, "").trim();

/** Best name match → { domain, linkedinUrl } or null. Search alone doesn't
 *  carry estimated_num_employees on mixed_companies, so we resolve the domain
 *  here and enrich in a second call. US-only: without the location filter a
 *  foreign same-name company can win the top slot. */
export async function apolloResolveOrg(companyName: string): Promise<{ domain: string | null; linkedinUrl: string | null } | null> {
	const data = await apolloPost("/mixed_companies/search", {
		q_organization_name: cleanName(companyName),
		organization_locations: ["United States"],
		per_page: 1,
	});
	const orgs = (data.organizations ?? []) as Array<Record<string, unknown>>;
	const org = orgs[0];
	if (!org) return null;
	// ponytail: name-match is still fuzzy; upgrade: require a domain match from funnel rawData.
	return {
		domain: typeof org.primary_domain === "string" ? org.primary_domain : null,
		linkedinUrl: typeof org.linkedin_url === "string" ? org.linkedin_url : null,
	};
}

/** Estimated employee count for the company. null = no data in Apollo. */
export async function apolloHeadcount(companyName: string): Promise<number | null> {
	const resolved = await apolloResolveOrg(companyName);
	if (!resolved?.domain) return null;
	const data = await apolloPost("/organizations/enrich", { domain: resolved.domain });
	const org = (data.organization ?? data) as Record<string, unknown>;
	const n = org.estimated_num_employees;
	return typeof n === "number" && n > 0 ? n : null;
}

const TECH_TITLES = ["CTO", "VP Engineering", "IT Director", "software engineer", "developer", "data engineer"];

/** Count of people at the company holding tech titles (the ≤2-hits gate). */
export async function apolloTechTitleHits(companyName: string): Promise<number | null> {
	const resolved = await apolloResolveOrg(companyName);
	if (!resolved?.domain) return null;
	const data = await apolloPost("/mixed_people/search", {
		q_organization_domains: [resolved.domain],
		person_titles: TECH_TITLES,
		page: 1,
		per_page: 1,
	});
	const total = (data.total_num_results ?? (data.pagination as { total_entries?: number } | undefined)?.total_entries) as number | undefined;
	return typeof total === "number" ? total : null;
}
