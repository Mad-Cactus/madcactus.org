import type { APIEvent } from "@solidjs/start/server";
import { getAuthedClient } from "~/lib/session";
import { getDocVersions, getVersionDiff } from "~/lib/docs";

/**
 * Docs version history — admin-session guarded.
 * GET /api/docs/:id/versions                → { versions } (id, author, createdAt, length)
 * GET /api/docs/:id/versions?diff=<vid>     → { diff } unified diff vs previous version
 */
function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const GET = async (event: APIEvent) => {
	if (!(await getAuthedClient())) return json({ error: "Unauthorized" }, 401);
	const url = new URL(event.request.url);
	const diffId = url.searchParams.get("diff");
	if (diffId) {
		const diff = await getVersionDiff(event.params.id, diffId);
		return diff === null ? json({ error: "version not found" }, 404) : json({ diff });
	}
	const versions = await getDocVersions(event.params.id);
	return json({
		versions: versions.map((v) => ({
			id: v.id,
			author: v.author,
			chatUuid: v.chatUuid,
			length: v.content.length,
			createdAt: v.createdAt,
		})),
	});
};
