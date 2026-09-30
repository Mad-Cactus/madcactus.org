// Freight pull CLI — same ImportYeti pull the dashboard button runs, for
// cron/agents. The lib does the work; see src/lib/fmcsa.ts.
//   cd dashboard
//   bun scripts/freight-pull.ts --run <runId> --limit 100
// Env: FUNNEL_API_KEY (mc_ key), FUNNEL_API_BASE (default http://localhost:3000).
import { discoverIndianaBrokers } from "../src/lib/fmcsa";

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
const rows = await discoverIndianaBrokers(LIMIT);
console.error(`[pull] discovered ${rows.length}, importing in batches of 100…`);
let imported = 0;
for (let i = 0; i < rows.length; i += 100) {
	const batch = rows.slice(i, i + 100);
	const res = await postItems(batch);
	imported += res.imported ?? 0;
	console.error(`[pull] batch: +${res.imported} new, ${res.duplicated} dup, ${res.skippedPromoted} already promoted`);
}
console.log(`done: ${imported} imported into run ${RUN_ID}`);
