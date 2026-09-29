// Pull companies from ImportYeti into an open run — the dashboard button's
// backend. Keyless but Cloudflare-gated (see lib/importyeti.ts); only works
// where the server runs on a residential/office IP (local dev). On Fly this
// will error — that is expected and shown to the user.
// POST /api/funnels/runs/:id/pull-yeti { limit?: number (default 50, max 200) }
import type { APIEvent } from "@solidjs/start/server";
import { funnelAuthed, getRunStages, importRunItems } from "~/lib/funnels";
import { discoverIndianaCompanies } from "~/lib/importyeti";

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const POST = async (event: APIEvent) => {
	if (!(await funnelAuthed(event.request))) return json({ error: "Unauthorized" }, 401);
	const info = await getRunStages(event.params.id);
	if (!info) return json({ error: "Run not found" }, 404);
	if (info.run.status !== "open") return json({ error: "Run is closed — reopen by creating a new run" }, 400);
	const body = (await event.request.json().catch(() => ({}))) as { limit?: number };
	const limit = Math.min(Math.max(Math.trunc(body.limit ?? 50), 1), 200);
	try {
		const companies = await discoverIndianaCompanies(limit);
		const { imported, duplicated, skippedPromoted } = await importRunItems(event.params.id, companies);
		return json({ ok: true, fetched: companies.length, imported, duplicated, skippedPromoted });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : "ImportYeti pull failed" }, 502);
	}
};
