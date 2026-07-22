import type { APIEvent } from "@solidjs/start/server";
import { getCookie } from "@solidjs/start/http";
import { supabaseService } from "~/lib/supabase";
import { embed } from "~/lib/embeddings";

/** Client-side search endpoint. Returns JSON search results.
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

	let queryEmbedding: number[];
	try {
		queryEmbedding = await embed(q);
	} catch (e) {
		return json({ error: "Search temporarily unavailable" }, 503);
	}

	const { data, error } = await svc.rpc("match_documents", {
		query_embedding: queryEmbedding,
		filter_project_id: client.project_id,
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
		content_snippet: d.content
			? d.content.slice(0, 300) + (d.content.length > 300 ? "…" : "")
			: null,
		similarity: Math.round(d.similarity * 100),
	}));

	return json({ results });
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
