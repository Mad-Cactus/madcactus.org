// FMCSA company census via the public Socrata API on data.transportation.gov
// (dataset az4n-8mr2). Keyless, no bot-walling — works from any IP, including
// prod. This is the RIGHT discovery source for the freight ICP: every company
// arranging interstate freight for others needs active MC authority, and
// "for-hire + 0 power units" = the asset-light broker/3PL profile (Koola:
// DOT 3257824 matches it exactly).
const CENSUS = "https://data.transportation.gov/resource/az4n-8mr2.json";

export type FmcsaCompany = {
	companyName: string;
	city: string | null;
	state: string;
	sourceUrl: string | null;
	sourceKind: string;
	rawData: Record<string, unknown>;
};

type CensusRow = {
	dot_number?: string;
	legal_name?: string;
	dba_name?: string | null;
	phy_city?: string | null;
	phy_state?: string;
	phone?: string | null;
	add_date?: string | null;
	docket1prefix?: string | null;
	docket1?: string | null;
};

/** Individuals with broker authority (no business entity) — noise for the funnel. */
const looksLikeBusiness = (name: string) =>
	/\b(LLC|INC|CORP|CORPORATION|LTD|COMPANY|CO\.|LOGISTICS|TRANSPORT|FREIGHT|TRUCK|EXPRESS|CARRIERS?)\b/i.test(name);

/** Active Indiana asset-light for-hire carriers/brokers, newest registrations first. */
export async function discoverIndianaBrokers(limit: number, foundedFrom = 2015): Promise<FmcsaCompany[]> {
	const where = [
		"phy_state='IN'",
		"classdef='AUTHORIZED FOR HIRE'",
		"status_code='A'",
		"power_units='0'",
		`add_date>='${foundedFrom}0101'`,
	].join(" AND ");
	const url = `${CENSUS}?$select=dot_number,legal_name,dba_name,phy_city,phy_state,phone,add_date,docket1prefix,docket1&$where=${encodeURIComponent(where)}&$order=add_date DESC&$limit=${limit}`;
	const res = await fetch(url, { headers: { Accept: "application/json" } });
	if (!res.ok) throw new Error(`FMCSA census HTTP ${res.status}`);
	const rows = (await res.json()) as CensusRow[];
	return rows
		.filter((r) => (r.dba_name || r.legal_name || "").trim())
		.filter((r) => looksLikeBusiness(r.dba_name || r.legal_name || ""))
		.map((r) => {
			const name = (r.dba_name || r.legal_name || "").trim();
			return {
				companyName: name,
				city: r.phy_city?.trim() || null,
				state: "IN",
				sourceUrl: r.dot_number ? `https://safer.fmcsa.dot.gov/CompanySnapshot.aspx?dot=${r.dot_number}` : null,
				sourceKind: "fmcsa",
				rawData: {
					dot: r.dot_number ?? null,
					mc: r.docket1prefix === "MC" ? r.docket1 : null,
					phone: r.phone ?? null,
					founded: r.add_date ? `${r.add_date.slice(0, 4)}-${r.add_date.slice(4, 6)}-${r.add_date.slice(6, 8)}` : null,
					industryType: "Freight brokerage / 3PL (FMCSA for-hire, asset-light)",
				},
			};
		});
}
