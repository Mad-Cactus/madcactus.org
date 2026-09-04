import type { APIEvent } from "@solidjs/start/server";
import { getAuthedClient } from "~/lib/session";
import { renameDoc, createDoc, getDoc, saveDocMarkdown, toggleShare, finalizeDoc, listDocVersions, getDocVersionDiff } from "~/lib/docs";

/**
 * Docs item API — admin-session guarded.
 * GET  /api/docs/:id   → doc (json)
 * GET  /api/docs/:id?versions=1 → version list (no content)
 * GET  /api/docs/:id?diff=N → word-diff of version N vs N-1
 * PUT  /api/docs/:id   { markdown } → { version }
 * POST /api/docs/:id   { op: "finalize" | "share", enabled? } → result
 */
async function requireAdmin() {
	return (await getAuthedClient()) !== null;
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const GET = async (event: APIEvent) => {
	if (!(await requireAdmin())) return json({ error: "Unauthorized" }, 401);
	const url = new URL(event.request.url);
	if (url.searchParams.has("versions")) return json({ versions: await listDocVersions(event.params.id) });
	const diffVer = Number(url.searchParams.get("diff"));
	if (Number.isInteger(diffVer) && diffVer > 0) {
		const diff = await getDocVersionDiff(event.params.id, diffVer);
		if (!diff) return json({ error: "Not found" }, 404);
		return json(diff);
	}
	const doc = await getDoc(event.params.id);
	if (!doc) return json({ error: "Not found" }, 404);
	return json(doc);
};

export const PUT = async (event: APIEvent) => {
	if (!(await requireAdmin())) return json({ error: "Unauthorized" }, 401);
	const body = (await event.request.json().catch(() => ({}))) as { markdown?: string };
	if (typeof body.markdown !== "string") return json({ error: "Missing markdown" }, 400);
	await saveDocMarkdown(event.params.id, body.markdown, "human");
	const doc = await getDoc(event.params.id);
	return json({ version: doc?.version ?? 0 });
};

export const POST = async (event: APIEvent) => {
	if (!(await requireAdmin())) return json({ error: "Unauthorized" }, 401);
	const body = (await event.request.json().catch(() => ({}))) as { op?: string; enabled?: boolean; title?: string };
	try {
		if (body.op === "rename") return json({ ok: await renameDoc(event.params.id, String(body.title ?? "").trim() || "Untitled") });
		if (body.op === "finalize") return json({ pairId: await finalizeDoc(event.params.id) });
		if (body.op === "share") return json({ shareToken: await toggleShare(event.params.id, body.enabled !== false) });
		return json({ error: "Unknown op" }, 400);
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : String(e) }, 400);
	}
};

// createDoc re-exported for discoverability; route handlers above are the API.
void createDoc;
