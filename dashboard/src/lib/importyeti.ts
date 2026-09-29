// ImportYeti search (keyless) — shared by the dashboard pull button and the
// freight-pull CLI. ImportYeti/FMCSA block datacenter ASNs, so this only works
// where a residential/office IP runs it (your machine in local dev). The
// public API has no key but sits behind Cloudflare, hence wreq for a real
// browser TLS fingerprint.
import { fetch as wreqFetch } from "wreq-js";

const SEARCH_URL = "https://api.importyeti.com/api/search";
const MIN_INTERVAL = 4000;

type SearchResult = {
	title: string;
	countryCode: string;
	type: string;
	address: string;
	totalShipments: number;
	url: string;
};

export type YetiCompany = {
	companyName: string;
	city: string | null;
	state: string;
	sourceUrl: string | null;
	sourceKind: string;
	rawData: Record<string, unknown>;
};

/** Address-only IN detection — name tokens like "Franklin" match other states. */
const isIndianaAddress = (a: string) => /,?\s*(IN|INDIANA)\b\s*(,|\d{5}|$)/i.test(a) || /,\s*IN\s*\d{5}/i.test(a);

let last = 0;
async function wreq(url: string): Promise<string> {
	const wait = MIN_INTERVAL - (Date.now() - last);
	if (wait > 0) await Bun.sleep(wait);
	last = Date.now();
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const r = await wreqFetch(url, {
				browser: "chrome_142",
				os: "windows",
				headers: {
					Accept: "application/json, text/plain, */*",
					"Accept-Language": "en-US,en;q=0.9",
					Origin: "https://www.importyeti.com",
					Referer: "https://www.importyeti.com/",
					...(process.env.IY_API_TOKEN ? { Cookie: `importyeti_token=${process.env.IY_API_TOKEN}` } : {}),
				},
			});
			if (r.status === 200) return await r.text();
			if (r.status === 404) return "";
		} catch (e) {
			console.error(`[importyeti] ${e instanceof Error ? e.message : e}`);
		}
		await Bun.sleep(5000 * (attempt + 1));
	}
	throw new Error(`importyeti failed: ${url.slice(0, 80)}`);
}

/** Search ImportYeti for Indiana companies, ranked by shipment count. */
export async function discoverIndianaCompanies(max: number): Promise<YetiCompany[]> {
	const seen = new Map<string, YetiCompany>();
	for (let page = 1; seen.size < max && page <= 25; page++) {
		const body = await wreq(`${SEARCH_URL}?q=indiana&page=${page}`);
		if (!body) break;
		const data = JSON.parse(body) as { searchResults?: SearchResult[] };
		const results = data.searchResults ?? [];
		if (results.length === 0) break;
		for (const r of results) {
			if (r.type !== "company" || r.countryCode !== "US" || !isIndianaAddress(r.address)) continue;
			const slug = r.url.split("/").pop() ?? "";
			if (!slug || seen.has(slug)) continue;
			// "123 Main St, Indianapolis, IN 46204" → city
			const m = r.address.match(/,\s*([^,]+),\s*(IN|Indiana)\s*(\d{5})?/i);
			seen.set(slug, {
				companyName: r.title,
				city: m?.[1]?.trim() ?? null,
				state: "IN",
				sourceUrl: `https://www.importyeti.com${r.url}`,
				sourceKind: "importyeti",
				rawData: { slug, address: r.address, totalShipments: r.totalShipments },
			});
		}
	}
	return [...seen.values()].sort((a, b) => (b.rawData.totalShipments as number) - (a.rawData.totalShipments as number)).slice(0, max);
}
