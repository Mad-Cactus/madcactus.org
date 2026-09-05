// Workspace search — raw-record retrieval over dashboard tables (email,
// documents/transcripts, markdown docs, projects). Distilled-knowledge
// search lives in brain/search.ts; both surface through /api/brain-mcp.
import { desc, eq, gte, sql } from "drizzle-orm";
import { db } from "~/db";
import {
	companies,
	deliverables,
	docs,
	documents,
	emailMessages,
	emailThreads,
	projects,
} from "~/db/schema";

// ── Search tools (shared by generation loop and brain MCP) ──────────

export async function searchWorkspace(query: string) {
	const q = query.trim();
	if (!q) return { emails: [], documents: [], docs: [], projects: [] };
	const tsq = sql`websearch_to_tsquery('english', ${q})`;
	const like = `%${q}%`;

	const emails = await db
		.select({
			subject: emailThreads.subject,
			from: emailMessages.fromName,
			date: emailMessages.date,
			snippet: sql<string>`left(${emailMessages.bodyText}, 400)`,
		})
		.from(emailMessages)
		.innerJoin(emailThreads, eq(emailThreads.id, emailMessages.threadId))
		.where(
			sql`to_tsvector('english', coalesce(${emailThreads.subject},'') || ' ' || ${emailMessages.bodyText}) @@ ${tsq}`,
		)
		.orderBy(desc(emailMessages.date))
		.limit(10);

	const docHits = await db
		.select({
			title: documents.title,
			created: documents.createdAt,
			snippet: sql<string>`left(coalesce(${documents.content}, ${documents.description}), 400)`,
		})
		.from(documents)
		.where(
			sql`to_tsvector('english', coalesce(${documents.title},'') || ' ' || coalesce(${documents.content},'') || ' ' || coalesce(${documents.description},'')) @@ ${tsq}`,
		)
		.orderBy(desc(documents.createdAt))
		.limit(10);

	const proj = await db
		.select({
			name: projects.name,
			status: projects.status,
			notes: projects.notes,
			company: companies.name,
		})
		.from(projects)
		.innerJoin(companies, eq(companies.id, projects.companyId))
		.where(sql`${projects.name} ILIKE ${like} OR coalesce(${projects.notes},'') ILIKE ${like} OR ${companies.name} ILIKE ${like}`)
		.limit(10);

	// workspace docs (markdown, versioned) — includes the Voice lessons corpus
	const mdDocs = await db
		.select({
			title: docs.title,
			status: docs.status,
			updated: docs.updatedAt,
			snippet: sql<string>`left(${docs.markdown}, 400)`,
		})
		.from(docs)
		.where(sql`to_tsvector('english', ${docs.title} || ' ' || ${docs.markdown}) @@ ${tsq}`)
		.orderBy(desc(docs.updatedAt))
		.limit(10);

	return { emails, documents: docHits, docs: mdDocs, projects: proj };
}

export async function recentActivity(days = 14) {
	const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
	const [emailCount] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(emailMessages)
		.where(gte(emailMessages.date, since));
	const recentEmails = await db
		.select({
			subject: emailThreads.subject,
			from: emailMessages.fromName,
			date: emailMessages.date,
		})
		.from(emailMessages)
		.innerJoin(emailThreads, eq(emailThreads.id, emailMessages.threadId))
		.where(gte(emailMessages.date, since))
		.orderBy(desc(emailMessages.date))
		.limit(20);
	const recentDocs = await db
		.select({ title: documents.title, created: documents.createdAt })
		.from(documents)
		.where(gte(documents.createdAt, since))
		.orderBy(desc(documents.createdAt))
		.limit(20);
	const activeProjects = await db
		.select({ name: projects.name, status: projects.status, company: companies.name })
		.from(projects)
		.innerJoin(companies, eq(companies.id, projects.companyId))
		.where(eq(projects.status, "active"));
	const openDeliverables = await db
		.select({ title: deliverables.title, status: deliverables.status, project: projects.name })
		.from(deliverables)
		.innerJoin(projects, eq(projects.id, deliverables.projectId))
		.where(sql`${deliverables.status} <> 'completed'`)
		.limit(30);
	return {
		since_days: days,
		email_count: emailCount?.n ?? 0,
		recent_emails: recentEmails,
		recent_documents: recentDocs,
		active_projects: activeProjects,
		open_deliverables: openDeliverables,
	};
}
