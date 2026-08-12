import type { APIEvent } from "@solidjs/start/server";
import { getCookie } from "@solidjs/start/http";
import { eq, and, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "~/db";
import { clientMembers, clientCompanyMembers, projects, documents } from "~/db/schema";

/** Client-side full-text search endpoint.
 *  Auth: client session cookie. */
export async function GET(event: APIEvent) {
	const memberId = getCookie("mc-client-session");
	if (!memberId) return json({ error: "Unauthorized" }, 401);

	// Verify member exists + active
	const [member] = await db
		.select({ id: clientMembers.id })
		.from(clientMembers)
		.where(eq(clientMembers.id, memberId))
		.limit(1);
	if (!member) return json({ error: "Unauthorized" }, 401);

	const q = new URL(event.request.url).searchParams.get("q");
	if (!q || q.trim().length < 2) return json({ results: [] });

	// Resolve member's project IDs
	const memberCompanies = await db
		.select({ companyId: clientCompanyMembers.companyId })
		.from(clientCompanyMembers)
		.where(eq(clientCompanyMembers.memberId, memberId));

	const companyIds = memberCompanies.map((c) => c.companyId);
	if (companyIds.length === 0) return json({ results: [] });

	const memberProjects = await db
		.select({ id: projects.id })
		.from(projects)
		.where(inArray(projects.companyId, companyIds));

	const projectIds = memberProjects.map((p) => p.id);
	if (projectIds.length === 0) return json({ results: [] });

	const results = await db.execute<{
		id: string;
		title: string;
		type: string;
		url: string | null;
		file_name: string | null;
		description: string | null;
		snippet: string | null;
	}>(sql`
		SELECT d.id, d.title, d.type, d.url, d.file_name, d.description,
			CASE WHEN d.content IS NOT NULL THEN
				ts_headline('english', d.content, websearch_to_tsquery('english', ${q}),
					'MaxFragments=1, MinWords=5, MaxWords=30')
			ELSE NULL END as snippet
		FROM documents d
		WHERE d.project_id = ANY(${projectIds}::uuid[])
			AND d.visibility = 'client'
			AND to_tsvector('english', coalesce(d.title,'') || ' ' || coalesce(d.description,'') || ' ' || coalesce(d.content,''))
				@@ websearch_to_tsquery('english', ${q})
		ORDER BY ts_rank(
				to_tsvector('english', coalesce(d.title,'') || ' ' || coalesce(d.description,'') || ' ' || coalesce(d.content,'')),
				websearch_to_tsquery('english', ${q})
			) DESC
		LIMIT 10
	`);

	const mapped = results.rows.map((d) => ({
		id: d.id,
		title: d.title,
		type: d.type,
		url: d.url,
		file_name: d.file_name,
		description: d.description,
		content_snippet: d.snippet ? d.snippet.replace(/<\/?b>/g, "") : null,
	}));

	return json({ results: mapped });
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
