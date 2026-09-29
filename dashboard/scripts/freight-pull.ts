// Freight pull — appends ImportYeti Indiana consignees to an open funnel run.
// YOU run this locally (bun dashboard/scripts/freight-pull.ts); it is not a
// scheduled or autonomous job. ImportYeti/FMCSA block datacenter ASNs, so this
// never runs on the Fly machine.
//
//   cd dashboard
//   bun scripts/freight-pull.ts --run <runId> --limit 100
//
// Env: FUNNEL_API_KEY (mc_ key), FUNNEL_API_BASE (default http://localhost:3000),
//      IY_API_TOKEN (optional ImportYeti token cookie).
// Idempotent: the API dedups (runId, company) and skips already-promoted
// companies, so re-running a partial pull loses nothing.
import { fetch as wreqFetch } from "wreq-js";

const SEARCH_URL = "https://api.importyeti.com/api/search";
const MIN_INTERVAL = 4000;

const args = process.argv.slice(2);
const arg = (name: string) => {
	const i = args.indexOf(`--${name}`);
	return i !== -1 && args[i + 1] ? args[i + 1] : null;
};
const RUN_ID = arg("run");
const LIMIT = parseInt(arg("limit") ?? "100", 10);
if (!RUN_ID) {
	console.error("usage: bun scripts/freight-pull.ts --run <runId> [--limit 100]");
	process.exit(1);
}
const BASE = process.env.FUNNEL_API_BASE ?? "http://localhost:3000";
const KEY = process.env.FUNNEL_API_KEY;
if (!KEY) {
	console.error("FUNNEL_API_KEY (mc_…) required");
	process.exit(1);
}

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
			console.error(`[importyeti] HTTP ${r.status} on ${url.slice(0, 80)}`);
			if (r.status === 404) return "";
		} catch (e) {
			console.error(`[importyeti] ${e instanceof Error ? e.message : e}`);
		}
		await Bun.sleep(5000 * (attempt + 1));
	}
	throw new Error(`importyeti failed: ${url.slice(0, 80)}`);
}

type SearchResult = { title: string; countryCode: string; type: string; address: string; totalShipments: number; url: string };

async function discover(max: number) {
	const seen = new Map<string, { name: string; address: string; city: string | null; state: string; totalShipments: number; slug: string }>();
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
			// "123 Main St, Indianapolis, IN 46204" → city/state
			const m = r.address.match(/,\s*([^,]+),\s*(IN|Indiana)\s*(\d{5})?/i);
			seen.set(slug, {
				name: r.title,
				address: r.address,
				city: m?.[1]?.trim() ?? null,
				state: "IN",
				totalShipments: r.totalShipments,
				slug,
			});
		}
		console.error(`[importyeti] page ${page}: ${seen.size} IN companies`);
	}
	return [...seen.values()].sort((a, b) => b.totalShipments - a.totalShipments).slice(0, max);
}

async function postItems(items: unknown[]) {
	const r = await fetch(`${BASE}/api/funnels/runs/${RUN_ID}/items`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
		body: JSON.stringify({ items }),
	});
	const body = (await r.json()) as { error?: string; imported?: number; duplicated?: number; skippedPromoted?: number };
	if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
	return body;
}

// ponytail: ImportYeti-only discovery. FMCSA census brokers (SAFER snapshot
// enrichment for authority/fleet data) are a later pass — same API, rawData
// already carries whatever a future fetcher adds.
const rows = await discover(LIMIT);
console.error(`[pull] discovered ${rows.length}, importing in batches of 100…`);
let imported = 0;
for (let i = 0; i < rows.length; i += 100) {
	const batch = rows.slice(i, i + 100).map((r) => ({
		companyName: r.name,
		city: r.city,
		state: r.state,
		sourceUrl: `https://www.importyeti.com/company/${r.slug}`,
		sourceKind: "importyeti",
		rawData: { address: r.address, totalShipments: r.totalShipments },
	}));
	const res = await postItems(batch);
	imported += res.imported ?? 0;
	console.error(`[pull] batch: +${res.imported} new, ${res.duplicated} dup, ${res.skippedPromoted} already promoted`);
}
console.log(`done: ${imported} imported into run ${RUN_ID}`);
