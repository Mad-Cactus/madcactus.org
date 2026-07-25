import type { APIEvent } from "@solidjs/start/server";
import { supabaseService } from "~/lib/supabase";
import { hashKey } from "~/lib/crypto";
import type { Client, Project } from "~/lib/supabase";

/**
 * MCP Server — Mad Cactus Client Portal
 *
 * Stateless JSON-RPC over HTTP. Authenticates via Bearer API key.
 * Exposes tools for clients to query their project data from any AI agent.
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

interface AuthedClient {
	client: Client;
	project: Project;
}

async function authenticate(
	request: Request,
): Promise<AuthedClient | null> {
	const auth = request.headers.get("authorization");
	if (!auth?.startsWith("Bearer ")) return null;
	const rawKey = auth.slice(7);
	if (!rawKey.startsWith("mc_")) return null;

	const svc = supabaseService();
	const { data: keyRecord } = await svc
		.from("api_keys")
		.select("id, client_id")
		.eq("key_hash", hashKey(rawKey))
		.is("revoked_at", null)
		.single();
	if (!keyRecord) return null;

	// Update last_used_at (fire and forget)
	await svc
		.from("api_keys")
		.update({ last_used_at: new Date().toISOString() })
		.eq("id", keyRecord.id);

	const { data: client } = await svc
		.from("clients")
		.select("*")
		.eq("id", keyRecord.client_id)
		.eq("is_active", true)
		.single();
	if (!client) return null;

	const { data: project } = await svc
		.from("projects")
		.select("*")
		.eq("id", (client as Client).project_id)
		.single();
	if (!project) return null;

	return { client: client as Client, project: project as Project };
}

// ── Tool definitions ───────────────────────────────────────────────

const TOOLS = [
	{
		name: "get_project_status",
		description:
			"Get the current status of the client's project — engagement type, rate, deliverables progress, and overall status.",
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
			"List all project deliverables with their current status (planned, in progress, review, completed, blocked) and progress updates. This is the primary way to see what work has been done and what's coming next.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "search_documents",
		description:
			"Semantic search across all project documents, transcripts, and shared links. Use this to find specific information — e.g. 'scope requirements', 'meeting notes about timeline', 'architecture decisions'.",
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

async function getProjectStatus(ctx: AuthedClient) {
	const svc = supabaseService();
	const { data: deliverables } = await svc
		.from("deliverables")
		.select("id, status")
		.eq("project_id", ctx.project.id);

	const all = deliverables ?? [];
	const completed = all.filter((d) => d.status === "completed").length;

	return {
		project: {
			name: ctx.project.name,
			client: ctx.project.client_name,
			type: ctx.project.engagement_type,
			hourly_rate: ctx.project.hourly_rate,
			status: ctx.project.status,
			notes: ctx.project.notes,
		},
		deliverables_progress: `${completed} / ${all.length} completed`,
		deliverable_statuses: all.map((d) => d.status),
	};
}

async function getDocuments(ctx: AuthedClient) {
	const svc = supabaseService();
	const { data } = await svc
		.from("documents")
		.select("title, type, url, file_name, description, created_at")
		.eq("project_id", ctx.project.id)
		.eq("visibility", "client")
		.order("created_at", { ascending: false });

	return (data ?? []).map((d) => ({
		title: d.title,
		type: d.type,
		description: d.description,
		url: d.type === "link" ? d.url : null,
		file: d.type !== "link" ? d.file_name : null,
		created: d.created_at,
	}));
}

async function getInvoices(ctx: AuthedClient) {
	const svc = supabaseService();
	const { data } = await svc
		.from("invoices")
		.select("number, amount, status, issue_date, due_date, payment_url, notes")
		.eq("project_id", ctx.project.id)
		.order("created_at", { ascending: false });

	return (data ?? []).map((i) => ({
		number: i.number,
		amount: `$${Number(i.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
		status: i.status,
		issued: i.issue_date,
		due: i.due_date,
		payment_url: i.payment_url,
		notes: i.notes,
	}));
}

async function getDeliverables(ctx: AuthedClient) {
	const svc = supabaseService();
	const { data } = await svc
		.from("deliverables")
		.select("title, description, status, updates:deliverable_updates(body, created_at)")
		.eq("project_id", ctx.project.id)
		.order("sort_order");

	return (data ?? []).map((d: any) => ({
		title: d.title,
		description: d.description,
		status: d.status,
		updates: (d.updates ?? []).map((u: any) => ({
			date: u.created_at,
			body: u.body,
		})),
	}));
}

async function searchDocuments(ctx: AuthedClient, params: { query: string }) {
	const { embed: embedFn } = await import("~/lib/embeddings");
	let queryEmbedding: number[];
	try {
		queryEmbedding = await embedFn(params.query);
	} catch {
		return { error: "Search is temporarily unavailable. Embeddings service not configured." };
	}
	const svc = supabaseService();
	const { data } = await svc.rpc("match_documents", {
		query_embedding: queryEmbedding,
		filter_project_id: ctx.project.id,
		match_count: 10,
	});
	return (data ?? []).map((d: any) => ({
		title: d.title,
		type: d.type,
		description: d.description,
		url: d.type === "link" ? d.url : null,
		content_snippet: d.content
			? d.content.slice(0, 500) + (d.content.length > 500 ? "…" : "")
			: null,
		similarity: Number((d.similarity * 100).toFixed(0)) + "%",
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

	// Handle JSON-RPC methods
	switch (body.method) {
		case "initialize":
			return rpcResponse(id, {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: { listChanged: false } },
				serverInfo: {
					name: "madcactus-portal",
					version: "1.0.0",
				},
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

/** OPTIONS handler for CORS preflight */
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

/** GET — return server info for health checks / browser access */
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
