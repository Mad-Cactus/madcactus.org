// Pull companies from the FMCSA census into an open run — the dashboard
// button's backend. Public Socrata API, keyless, works from any IP.
// POST /api/funnels/runs/:id/pull-fmcsa { limit?: number (default 200, max 1600) }
import type { APIEvent } from "@solidjs/start/server";
import { funnelAuthed, getRunStages, importRunItems } from "~/lib/funnels";
import { discoverIndianaBrokers } from "~/lib/fmcsa";

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const POST = async (event: APIEvent) => {
	if (!(await funnelAuthed(event.request))) return json({ error: "Unauthorized" }, 401);
	const info = await getRunStages(event.params.id);
	if (!info) return json({ error: "Run not found" }, 404);
	if (info.run.status !== "open") return json({ error: "Run is closed — reopen by creating a new run" }, 400);
	const body = (await event.request.json().catch(() => ({}))) as { limit?: number };
	const limit = Math.min(Math.max(Math.trunc(body.limit ?? 200), 1), 1600);
	try {
		const companies = await discoverIndianaBrokers(limit);
		const { imported, duplicated, skippedPromoted } = await importRunItems(event.params.id, companies);
		return json({ ok: true, fetched: companies.length, imported, duplicated, skippedPromoted });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : "FMCSA pull failed" }, 502);
	}
};
