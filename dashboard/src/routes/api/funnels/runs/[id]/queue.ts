// Stage queue — items with all earlier stages passed and this stage missing.
// GET /api/funnels/runs/:id/queue?stage=headcount → { stage, items }
import type { APIEvent } from "@solidjs/start/server";
import { funnelAuthed, getQueue } from "~/lib/funnels";

export const GET = async (event: APIEvent) => {
	if (!(await funnelAuthed(event.request))) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
	}
	const stage = new URL(event.request.url).searchParams.get("stage") ?? "";
	if (!stage) return new Response(JSON.stringify({ error: "stage required" }), { status: 400, headers: { "Content-Type": "application/json" } });
	const items = await getQueue(event.params.id, stage);
	if (!items) return new Response(JSON.stringify({ error: "Run not found or unknown stage" }), { status: 404, headers: { "Content-Type": "application/json" } });
	return new Response(JSON.stringify({ stage, items }), { headers: { "Content-Type": "application/json" } });
};
