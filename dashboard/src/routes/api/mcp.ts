import type { APIEvent } from "@solidjs/start/server";
import { eq, and, inArray, desc, gt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { hashKey } from "~/lib/crypto";
import { db } from "~/db";
import {
	apiKeys,
	clientMembers,
	clientCompanyMembers,
	projects,
	companies,
	documents,
	invoices,
	deliverables,
	deliverableUpdates,
} from "~/db/schema";

/**
 * MCP Server — Mad Cactus Client Portal
 *
 * Stateless JSON-RPC over HTTP. Authenticates via Bearer API key.
 * A member's key grants access to all projects across their companies.
 *
 * Endpoint: POST /api/mcp
 * Auth: Authorization: Bearer mc_<key>
 */

const PROTOCOL_VERSION = "2025-06-18";

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
		},
	});
}

function rpcResponse(id: string | number | null, result: unknown) {
	return json({ jsonrpc: "2.0", id, result });
}

function rpcError(
	id: string | number | null,
	code: number,
	message: string,
) {
	return json({ jsonrpc: "2.0", id, error: { code, message } });
}

interface AuthedMember {
	member: { id: string; name: string; email: string };
	projectIds: string[];
	lastUsedAt: Date | null; // captured before the last_used_at update fires
}

async function authenticate(request: Request): Promise<AuthedMember | null> {
	const auth = request.headers.get("authorization");
	if (!auth?.startsWith("Bearer ")) return null;
	const rawKey = auth.slice(7);
	if (!rawKey.startsWith("mc_")) return null;

	const [keyRow] = await db
		.select({ id: apiKeys.id, memberId: apiKeys.memberId, lastUsedAt: apiKeys.lastUsedAt })
		.from(apiKeys)
		.where(and(eq(apiKeys.keyHash, hashKey(rawKey)), sql`${apiKeys.revokedAt} IS NULL`))
		.limit(1);
	if (!keyRow) return null;

	// Update last_used_at (fire and forget)
	db.update(apiKeys)
		.set({ lastUsedAt: new Date() })
		.where(eq(apiKeys.id, keyRow.id))
		.then(() => {})
		.catch(() => {});

	const [member] = await db
		.select({ id: clientMembers.id, name: clientMembers.name, email: clientMembers.email })
		.from(clientMembers)
		.where(and(eq(clientMembers.id, keyRow.memberId), eq(clientMembers.isActive, true)))
		.limit(1);
	if (!member) return null;

	// Resolve all project IDs across the member's companies
	const memberCompanies = await db
		.select({ companyId: clientCompanyMembers.companyId })
		.from(clientCompanyMembers)
		.where(eq(clientCompanyMembers.memberId, member.id));

	const companyIds = memberCompanies.map((c) => c.companyId);
	if (companyIds.length === 0) return { member, projectIds: [], lastUsedAt: keyRow.lastUsedAt };

	const memberProjects = await db
		.select({ id: projects.id })
		.from(projects)
		.where(inArray(projects.companyId, companyIds));

	return {
		member,
		projectIds: memberProjects.map((p) => p.id),
		lastUsedAt: keyRow.lastUsedAt,
	};
}

// ── Tool definitions ───────────────────────────────────────────────

const TOOLS = [
	{
		name: "get_project_status",
		description:
			"Get the current status of all the client's projects — engagement type, rate, deliverables progress, and overall status.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "get_documents",
		description:
			"List all documents shared with the client — Google Doc links, uploaded files, and meeting transcripts.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "get_invoices",
		description:
			"List all invoices for the client, including amounts, status (draft/sent/paid), and payment links.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "get_deliverables",
		description:
			"List all project deliverables with their current status and progress updates.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "get_daily_briefing",
		description:
			"Everything that changed across the client's projects since the last time this MCP server was called (new deliverable updates, new documents, new invoices), plus a one-line status snapshot per project. Best starting point for a daily check-in summary.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "search_documents",
		description:
			"Search across all project documents and transcripts by keyword. Returns matching documents with relevant text snippets.",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Natural language search query",
				},
			},
			required: ["query"],
		},
	},
] as const;

// ── Tool implementations ───────────────────────────────────────────

async function getProjectStatus(ctx: AuthedMember) {
	if (ctx.projectIds.length === 0) return { projects: [] };

	const rows = await db
		.select({
			name: projects.name,
			companyName: companies.name,
			engagementType: projects.engagementType,
			hourlyRate: projects.hourlyRate,
			fixedPrice: projects.fixedPrice,
			status: projects.status,
			notes: projects.notes,
		})
		.from(projects)
		.innerJoin(companies, eq(companies.id, projects.companyId))
		.where(inArray(projects.id, ctx.projectIds));

	return { projects: rows };
}

async function getDocuments(ctx: AuthedMember) {
	if (ctx.projectIds.length === 0) return [];
	const rows = await db
		.select({
			title: documents.title,
			type: documents.type,
			url: documents.url,
			fileName: documents.fileName,
			audioFileName: documents.audioFileName,
			description: documents.description,
			createdAt: documents.createdAt,
		})
		.from(documents)
		.where(and(inArray(documents.projectId, ctx.projectIds), eq(documents.visibility, "client")))
		.orderBy(desc(documents.createdAt));

	return rows.map((d) => ({
		title: d.title,
		type: d.type,
		description: d.description,
		url: d.type === "link" ? d.url : null,
		file: d.type !== "link" ? d.fileName : null,
		audio: d.audioFileName || null,
		created: d.createdAt,
	}));
}

async function getInvoices(ctx: AuthedMember) {
	if (ctx.projectIds.length === 0) return [];
	const rows = await db
		.select()
		.from(invoices)
		.where(inArray(invoices.projectId, ctx.projectIds))
		.orderBy(desc(invoices.createdAt));

	return rows.map((i) => ({
		number: i.number,
		amount: `$${Number(i.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
		status: i.status,
		issued: i.issueDate,
		due: i.dueDate,
		payment_url: i.paymentUrl,
		notes: i.notes,
	}));
}

async function getDeliverables(ctx: AuthedMember) {
	if (ctx.projectIds.length === 0) return [];
	const delvs = await db
		.select()
		.from(deliverables)
		.where(inArray(deliverables.projectId, ctx.projectIds))
		.orderBy(deliverables.sortOrder);

	if (delvs.length === 0) return [];

	const updates = await db
		.select()
		.from(deliverableUpdates)
		.where(inArray(deliverableUpdates.deliverableId, delvs.map((d) => d.id)));

	const byId = new Map<string, typeof updates>();
	for (const u of updates) {
		const arr = byId.get(u.deliverableId) ?? [];
		arr.push(u);
		byId.set(u.deliverableId, arr);
	}

	return delvs.map((d) => ({
		title: d.title,
		description: d.description,
		status: d.status,
		updates: (byId.get(d.id) ?? []).map((u) => ({
			date: u.createdAt,
			body: u.body,
		})),
	}));
}

async function getDailyBriefing(ctx: AuthedMember) {
	const since = ctx.lastUsedAt ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // ponytail: first-ever call = last 7 days

	if (ctx.projectIds.length === 0) {
		return { since, projects: [], new_updates: [], new_documents: [], new_invoices: [] };
	}

	const projectRows = await db
		.select({
			name: projects.name,
			status: projects.status,
		})
		.from(projects)
		.where(inArray(projects.id, ctx.projectIds));

	const newUpdates = await db
		.select({
			project: projects.name,
			deliverable: deliverables.title,
			status: deliverables.status,
			date: deliverableUpdates.createdAt,
			body: deliverableUpdates.body,
		})
		.from(deliverableUpdates)
		.innerJoin(deliverables, eq(deliverables.id, deliverableUpdates.deliverableId))
		.innerJoin(projects, eq(projects.id, deliverables.projectId))
		.where(
			and(
				inArray(deliverables.projectId, ctx.projectIds),
				gt(deliverableUpdates.createdAt, since),
			),
		)
		.orderBy(desc(deliverableUpdates.createdAt));

	const newDocuments = await db
		.select({
			title: documents.title,
			type: documents.type,
			description: documents.description,
			url: documents.url,
			created: documents.createdAt,
		})
		.from(documents)
		.where(
			and(
				inArray(documents.projectId, ctx.projectIds),
				eq(documents.visibility, "client"),
				gt(documents.createdAt, since),
			),
		)
		.orderBy(desc(documents.createdAt));

	const newInvoices = await db
		.select({
			number: invoices.number,
			amount: invoices.amount,
			status: invoices.status,
			issued: invoices.issueDate,
			due: invoices.dueDate,
			payment_url: invoices.paymentUrl,
			created: invoices.createdAt,
		})
		.from(invoices)
		.where(and(inArray(invoices.projectId, ctx.projectIds), gt(invoices.createdAt, since)))
		.orderBy(desc(invoices.createdAt));

	return {
		since,
		note: "Changes since the last time this API key called the server. First-ever call defaults to the last 7 days.",
		projects: projectRows,
		new_updates: newUpdates,
		new_documents: newDocuments.map((d) => ({
			title: d.title,
			type: d.type,
			description: d.description,
			url: d.type === "link" ? d.url : null,
			created: d.created,
		})),
		new_invoices: newInvoices.map((i) => ({
			number: i.number,
			amount: `$${Number(i.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
			status: i.status,
			issued: i.issued,
			due: i.due,
			payment_url: i.payment_url,
			created: i.created,
		})),
	};
}

async function searchDocuments(ctx: AuthedMember, params: { query: string }) {
	if (ctx.projectIds.length === 0 || !params.query?.trim()) return [];

	const results = await db.execute<{
		title: string;
		type: string;
		url: string | null;
		file_name: string | null;
		description: string | null;
		snippet: string | null;
	}>(sql`
		SELECT d.title, d.type, d.url, d.file_name, d.description,
			CASE WHEN d.content IS NOT NULL THEN
				ts_headline('english', d.content, websearch_to_tsquery('english', ${params.query}),
					'MaxFragments=1, MinWords=5, MaxWords=30')
			ELSE NULL END as snippet,
			ts_rank(
				to_tsvector('english', coalesce(d.title,'') || ' ' || coalesce(d.description,'') || ' ' || coalesce(d.content,'')),
				websearch_to_tsquery('english', ${params.query})
			)::real as rank
		FROM documents d
		WHERE d.project_id = ANY(${ctx.projectIds}::uuid[])
			AND d.visibility = 'client'
			AND to_tsvector('english', coalesce(d.title,'') || ' ' || coalesce(d.description,'') || ' ' || coalesce(d.content,''))
				@@ websearch_to_tsquery('english', ${params.query})
		ORDER BY rank DESC
		LIMIT 10
	`);

	return results.map((d) => ({
		title: d.title,
		type: d.type,
		description: d.description,
		url: d.type === "link" ? d.url : null,
		content_snippet: d.snippet ? d.snippet.replace(/<\/?b>/g, "") : null,
	}));
}

// ── HTTP handler ───────────────────────────────────────────────────

export async function POST(event: APIEvent) {
	const ctx = await authenticate(event.request);
	if (!ctx) {
		return json(
			{ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized — invalid or revoked API key" } },
			401,
		);
	}

	let body: { jsonrpc?: string; id?: string | number; method?: string; params?: any };
	try {
		body = await event.request.json();
	} catch {
		return json(
			{ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
			400,
		);
	}

	const id = body.id ?? null;

	switch (body.method) {
		case "initialize":
			return rpcResponse(id, {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: { listChanged: false } },
				serverInfo: { name: "madcactus-portal", version: "1.0.0" },
			});

		case "notifications/initialized":
			return new Response(null, { status: 202 });

		case "tools/list":
			return rpcResponse(id, { tools: TOOLS });

		case "tools/call": {
			const toolName = body.params?.name;
			const toolArgs = body.params?.arguments ?? {};
			try {
				let result: unknown;
				switch (toolName) {
					case "get_project_status":
						result = await getProjectStatus(ctx);
						break;
					case "get_documents":
						result = await getDocuments(ctx);
						break;
					case "get_invoices":
						result = await getInvoices(ctx);
						break;
					case "get_deliverables":
						result = await getDeliverables(ctx);
						break;
					case "get_daily_briefing":
						result = await getDailyBriefing(ctx);
						break;
					case "search_documents":
						result = await searchDocuments(ctx, toolArgs);
						break;
					default:
						return rpcError(id, -32601, `Unknown tool: ${toolName}`);
				}
				return rpcResponse(id, {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				});
			} catch (err) {
				return rpcError(id, -32603, `Tool execution error: ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		case "ping":
			return rpcResponse(id, {});

		default:
			return rpcError(id, -32601, `Method not found: ${body.method}`);
	}
}

export function OPTIONS() {
	return new Response(null, {
		status: 204,
		headers: {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "POST, OPTIONS",
			"Access-Control-Allow-Headers": "Authorization, Content-Type",
		},
	});
}

export function GET() {
	return json({
		server: "madcactus-portal",
		version: "1.0.0",
		protocol: PROTOCOL_VERSION,
		endpoint: "POST /api/mcp",
		auth: "Authorization: Bearer mc_<your-api-key>",
		tools: TOOLS.map((t) => t.name),
	});
}
