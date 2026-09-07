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

// issue-01 lives as a hand-built static page (routes/newsletter/issue-01.tsx)
// from before issues lived in the DB — DB numbering continues after it.
// ponytail: delete the static page + drop the offset once issue-01 is a DB doc.
const STATIC_ISSUE_OFFSET = 1;

export async function listPublishedDispatch(): Promise<DispatchIssue[]> {
	const rows = await db
		.select({ id: docs.id, title: docs.title, publishedAt: docs.publishedAt })
		.from(docs)
		.where(and(eq(docs.kind, "newsletter"), eq(docs.status, "published")))
		.orderBy(desc(docs.publishedAt))
		.limit(100);
	return rows.map((r, i) => ({ ...r, issueNumber: STATIC_ISSUE_OFFSET + rows.length - i }));
}

export async function getPublishedDispatch(id: string): Promise<(DispatchIssue & { markdown: string }) | null> {
	if (!UUID_RE.test(id)) return null;
	const [row] = await db
		.select({ id: docs.id, title: docs.title, publishedAt: docs.publishedAt, markdown: docs.markdown })
		.from(docs)
		.where(and(eq(docs.id, id), eq(docs.kind, "newsletter"), eq(docs.status, "published")));
	if (!row) return null;
	const all = await listPublishedDispatch();
	return { ...row, issueNumber: all.find((i) => i.id === id)?.issueNumber ?? 0 };
}
