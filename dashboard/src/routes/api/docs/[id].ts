import type { APIEvent } from "@solidjs/start/server";
import { getAuthedClient } from "~/lib/session";
import {
	renameDoc,
	createDoc,
	getDoc,
	saveDocMarkdown,
	toggleShare,
	setDocStatus,
	setPublishState,
	setDocKind,
	setDocGenre,
	scheduleDoc,
	unscheduleDoc,
	deleteDoc,
	listDocVersions,
	getDocVersionDiff,
} from "~/lib/docs";

/**
 * Docs item API — admin-session guarded.
 * GET  /api/docs/:id   → doc (json)
 * GET  /api/docs/:id?versions=1 → version list (no content)
 * GET  /api/docs/:id?diff=N → word-diff of version N vs N-1
 * PUT  /api/docs/:id   { markdown } → { version }
 * POST /api/docs/:id   { op: "finalize" | "share" | "rename" | "set-kind" | "set-genre" | "schedule" | "unschedule" | "set-publish-state", ... } → result
 * DELETE /api/docs/:id → { ok }  (hard-deletes the doc + version history)
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
	const body = (await event.request.json().catch(() => ({}))) as {
		op?: string;
		enabled?: boolean;
		title?: string;
		kind?: string;
		genre?: string | null;
		scheduledFor?: string;
		firstComment?: string;
		state?: string;
	};
	try {
		if (body.op === "rename") return json({ ok: await renameDoc(event.params.id, String(body.title ?? "").trim() || "Untitled") });
		if (body.op === "finalize") {
			await setDocStatus(event.params.id, "final");
			return json({ ok: true, status: "final" });
		}
		if (body.op === "share") return json({ shareToken: await toggleShare(event.params.id, body.enabled !== false) });
		if (body.op === "set-kind") {
			const kind = body.kind === "post" || body.kind === "newsletter" ? body.kind : null;
			await setDocKind(event.params.id, kind);
			return json({ ok: true, kind });
		}
		if (body.op === "set-genre") {
			const genre = typeof body.genre === "string" && body.genre.trim() ? body.genre : null;
			await setDocGenre(event.params.id, genre);
			return json({ ok: true, genre: genre?.trim().toLowerCase() ?? null });
		}
		if (body.op === "schedule") {
			const when = new Date(String(body.scheduledFor));
			if (Number.isNaN(when.getTime())) return json({ error: "Invalid scheduledFor — use an ISO datetime" }, 400);
			await scheduleDoc(event.params.id, when, body.firstComment);
			return json({ ok: true, status: "scheduled", scheduledFor: when.toISOString() });
		}
		if (body.op === "unschedule") {
			await unscheduleDoc(event.params.id);
			return json({ ok: true, status: "final" });
		}
		if (body.op === "set-publish-state") {
			const state = body.state === "published" || body.state === "final" ? body.state : null;
			if (!state) return json({ error: "state must be 'final' or 'published'" }, 400);
			const doc = await setPublishState(event.params.id, state);
			if (!doc) return json({ error: "Not found" }, 404);
			return json({ ok: true, status: doc.status, publishedAt: doc.publishedAt?.toISOString() ?? null });
		}
		return json({ error: "Unknown op" }, 400);
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : String(e) }, 400);
	}
};

// createDoc re-exported for discoverability; route handlers above are the API.
void createDoc;

export const DELETE = async (event: APIEvent) => {
	if (!(await requireAdmin())) return json({ error: "Unauthorized" }, 401);
	try {
		const ok = await deleteDoc(event.params.id);
		return ok ? json({ ok: true }) : json({ error: "Not found" }, 404);
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : String(e) }, 400);
	}
};
