import type { APIEvent } from "@solidjs/start/server";
import { getAuthedClient } from "~/lib/session";
import { createDoc, listDocs } from "~/lib/docs";

/**
 * Docs collection API — admin-session guarded.
 * GET  /api/docs  → list
 * POST /api/docs  { title } → doc
 */
async function requireAdmin() {
	return (await getAuthedClient()) !== null;
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const GET = async () => {
	if (!(await requireAdmin())) return json({ error: "Unauthorized" }, 401);
	return json(await listDocs());
};

export const POST = async (event: APIEvent) => {
	if (!(await requireAdmin())) return json({ error: "Unauthorized" }, 401);
	const body = (await event.request.json().catch(() => ({}))) as { title?: string };
	return json(await createDoc(body.title ?? "Untitled"));
};
