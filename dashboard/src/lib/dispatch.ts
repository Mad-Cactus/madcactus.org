// Public Cactus Dispatch issues — published newsletters, served straight from
// the dashboard DB so marketing never redeploys per issue (tiny headless CMS).
import { and, desc, eq } from "drizzle-orm";
import { db } from "~/db";
import { docs } from "~/db/schema";
import { UUID_RE } from "~/lib/uuid";

export type DispatchIssue = {
	id: string;
	title: string;
	publishedAt: Date | null;
	issueNumber: number;
};

export async function listPublishedDispatch(): Promise<DispatchIssue[]> {
	const rows = await db
		.select({ id: docs.id, title: docs.title, publishedAt: docs.publishedAt, issueNumber: docs.issueNumber })
		.from(docs)
		.where(and(eq(docs.kind, "newsletter"), eq(docs.status, "published")))
		.orderBy(desc(docs.publishedAt))
		.limit(100);
	// number is minted at first publish and stored — unlisting an issue never
	// renumbers the rest
	return rows.map((r) => ({ ...r, issueNumber: r.issueNumber ?? 0 }));
}

export async function getPublishedDispatch(
	id: string,
): Promise<(DispatchIssue & { markdown: string; webMarkdown: string | null; webAppendix: string }) | null> {
	if (!UUID_RE.test(id)) return null;
	const [row] = await db
		.select({
			id: docs.id,
			title: docs.title,
			publishedAt: docs.publishedAt,
			issueNumber: docs.issueNumber,
			markdown: docs.markdown,
			webMarkdown: docs.webMarkdown,
			webAppendix: docs.webAppendix,
		})
		.from(docs)
		.where(and(eq(docs.id, id), eq(docs.kind, "newsletter"), eq(docs.status, "published")));
	if (!row) return null;
	return { ...row, issueNumber: row.issueNumber ?? 0 };
}
