import type { APIEvent } from "@solidjs/start/server";
import { getAuthedClient } from "~/lib/session";
import { searchAll } from "~/registry/registry";

/** Component search — admin-session guarded. Backs the doc editor's @
 *  typeahead (and any admin UI that needs a component finder). */
export async function GET(event: APIEvent) {
	if (!(await getAuthedClient())) return Response.json({ error: "Unauthorized" }, { status: 401 });
	const q = new URL(event.request.url).searchParams.get("q") ?? "";
	return Response.json({ hits: await searchAll(q, 8) });
}
