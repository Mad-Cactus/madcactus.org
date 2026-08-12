import type { APIEvent } from "@solidjs/start/server";
import { getCookie } from "@solidjs/start/http";
import { supabaseService } from "~/lib/supabase";

/** Client-side full-text search endpoint.
 *  Auth: client session cookie. */
export async function GET(event: APIEvent) {
	const clientId = getCookie("mc-client-session");
	if (!clientId) return json({ error: "Unauthorized" }, 401);

	const svc = supabaseService();
	const { data: client } = await svc
		.from("clients")
		.select("project_id")
		.eq("id", clientId)
		.eq("is_active", true)
		.single();
	if (!client) return json({ error: "Unauthorized" }, 401);

	const q = new URL(event.request.url).searchParams.get("q");
	if (!q || q.trim().length < 2) return json({ results: [] });

	const { data, error } = await svc.rpc("search_documents_fts", {
		filter_project_id: client.project_id,
		search_text: q,
		match_count: 10,
	});

	if (error) return json({ error: "Search failed" }, 500);

	const results = (data ?? []).map((d: any) => ({
		id: d.id,
		title: d.title,
		type: d.type,
		url: d.url,
		file_name: d.file_name,
		description: d.description,
		content_snippet: d.snippet
			? d.snippet.replace(/<\/?b>/g, "")
			: null,
	}));

	return json({ results });
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
