import type { APIEvent } from "@solidjs/start/server";
import { getAuthedClient } from "~/lib/session";
import { resolveCard } from "~/registry/registry";

/** One component card — admin-session guarded. Backs mention chip labels +
 *  hover popovers in the doc editor. Deleted targets return a deleted card
 *  (never 404) so dangling mentions degrade instead of breaking. */
export async function GET(event: APIEvent) {
	if (!(await getAuthedClient())) return Response.json({ error: "Unauthorized" }, { status: 401 });
	const url = new URL(event.request.url);
	const kind = url.searchParams.get("kind") ?? "";
	const id = url.searchParams.get("id") ?? "";
	if (!kind || !id) return Response.json({ error: "kind and id required" }, { status: 400 });
	return Response.json({ card: await resolveCard({ kind, id }) });
}
