// Apollo enrichment for funnel api-stages (headcount, tech_team).
// Reads APOLLO_API_KEY (free tier to start). Absent key → apolloConfigured()
// is false and the "Run stage" button reports the driver unconfigured.
// Docs: https://docs.apollo.io — mixed_companies/search + mixed_people/search.
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

/** Estimated employee count for the best name match. null = no confident match. */
export async function apolloHeadcount(companyName: string): Promise<number | null> {
	const data = await apolloPost("/mixed_companies/search", { q_organization_name: companyName, per_page: 1 });
	const orgs = (data.organizations ?? []) as Array<Record<string, unknown>>;
	const org = orgs[0];
	if (!org) return null;
	// ponytail: name-match is fuzzy on Apollo's side; a totally different company
	// can win the top slot. Upgrade: require a domain match from funnel rawData.
	const n = org.estimated_num_employees;
	return typeof n === "number" && n > 0 ? n : null;
}

const TECH_TITLES = ["CTO", "VP Engineering", "IT Director", "software engineer", "developer", "data engineer"];

/** Count of people at the company holding tech titles (the ≤2-hits gate). */
export async function apolloTechTitleHits(companyName: string): Promise<number | null> {
	const data = await apolloPost("/mixed_people/search", {
		q_organization_names: [companyName],
		person_titles: TECH_TITLES,
		page: 1,
		per_page: 1,
	});
	const total = (data.total_num_results ?? (data.pagination as { total_entries?: number } | undefined)?.total_entries) as number | undefined;
	return typeof total === "number" ? total : null;
}
