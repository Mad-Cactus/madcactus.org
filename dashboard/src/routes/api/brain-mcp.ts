import type { APIEvent } from "@solidjs/start/server";
import { eq, and, sql } from "drizzle-orm";
import { hashKey } from "~/lib/crypto";
import { db } from "~/db";
import { apiKeys, companies } from "~/db/schema";
import {
	getMemory,
	searchWorkspace,
	searchBrain,
	recentActivity,
} from "~/lib/brain/memory";
import { agentWrite, createDoc, getDoc, getDocVersionDiff, listDocVersions, listDocs } from "~/lib/docs";

/**
 * MCP Server — Mad Cactus Company Brain (internal agents)
 *
 * Same stateless JSON-RPC shape as /api/mcp, but scoped to the firm:
 * admin (memberless) API keys only. Serves the generated company/client
 * memory and search over workspace + gbrain.
 *
 * Endpoint: POST /api/brain-mcp
 * Auth: Authorization: Bearer mc_<admin-key>  (memberless key)
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

function rpcError(id: string | number | null, code: number, message: string) {
	return json({ jsonrpc: "2.0", id, error: { code, message } });
}

async function authenticate(request: Request): Promise<boolean> {
	const auth = request.headers.get("authorization");
	if (!auth?.startsWith("Bearer ")) return false;
	const rawKey = auth.slice(7);
	if (!rawKey.startsWith("mc_")) return false;

	const [keyRow] = await db
		.select({ id: apiKeys.id, memberId: apiKeys.memberId })
		.from(apiKeys)
		.where(and(eq(apiKeys.keyHash, hashKey(rawKey)), sql`${apiKeys.revokedAt} IS NULL`))
		.limit(1);
	// brain access is internal: memberless (admin) keys only
	return !!keyRow && keyRow.memberId === null;
}

async function resolveClient(name: string) {
	const [company] = await db
		.select({ id: companies.id, name: companies.name })
		.from(companies)
		.where(
			sql`${companies.name} ILIKE ${"%" + name + "%"} OR coalesce(${companies.aliases},'') ILIKE ${"%" + name + "%"}`,
		)
		.limit(1);
	return company ?? null;
}

function memoryResult(m: { memory: string | null; generatedAt: Date | null }, scope: string) {
	return {
		memory: m.memory,
		generated_at: m.generatedAt,
		scope,
		note: m.memory
			? "Refreshed in the background nightly. For recent specifics (message bodies, amounts, dates), call search_workspace or search_brain."
			: "No memory generated yet — a background generation just started; call again in a minute. Use search_workspace meanwhile.",
	};
}

// ── Tool definitions ───────────────────────────────────────────────

const TOOLS = [
	{
		name: "get_company_memory",
		description:
			"CALL THIS FIRST in every session. Returns the generated company memory — who Mad Cactus is, active clients, projects, priorities, and domain context. Prefer this over re-deriving context from search.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "get_client_memory",
		description:
			"Returns the generated memory for one client engagement — relationship history, project state, people, and open threads. Use for any client-specific question.",
		inputSchema: {
			type: "object",
			properties: {
				client: { type: "string", description: "Client name (fuzzy match, aliases work)" },
			},
			required: ["client"],
		},
	},
	{
		name: "search_workspace",
		description:
			"Full-text search across synced email, documents, and projects. Use after the memory tools for recent specifics.",
		inputSchema: {
			type: "object",
			properties: { query: { type: "string" } },
			required: ["query"],
		},
	},
	{
		name: "search_brain",
		description:
			"Search the long-term knowledge brain (gbrain) — meetings, sessions, connector data. Use for background knowledge and history that predates the workspace DB.",
		inputSchema: {
			type: "object",
			properties: { query: { type: "string" } },
			required: ["query"],
		},
	},
	{
		name: "get_recent_activity",
		description: "What changed recently across the workspace: email/doc counts, latest emails and docs, active projects, open deliverables.",
		inputSchema: {
			type: "object",
			properties: { days: { type: "number", description: "lookback window, default 14" } },
		},
	},
	{
		name: "list_clients",
		description: "List all client companies (for resolving get_client_memory arguments).",
		inputSchema: { type: "object", properties: {} },
	},
	// ── Docs ──
	{
		name: "create_doc",
		description:
			"Create a markdown doc and return its id. doc ids are UUIDs — use this when list_docs has no fitting doc before write_doc.",
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string" },
				markdown: { type: "string", description: "Optional initial body." },
			},
			required: ["title"],
		},
	},
	{
		name: "list_docs",
		description:
			"List markdown docs (id, title, status, version, updatedAt). status=draft means an agent write awaits human review.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "get_doc",
		description:
			"Get a doc's current markdown. The 'Voice lessons' doc holds Collin's writing rules — read it before drafting any email or doc for him.",
		inputSchema: {
			type: "object",
			properties: { doc_id: { type: "string" } },
			required: ["doc_id"],
		},
	},
	{
		name: "write_doc",
		description:
			"Write into a markdown doc as an attributed agent edit. mode: append (default) adds a section; replace rewrites the body. Your write lands as an agent version and re-opens the doc for human review (status=draft). Pass chat_uuid = your session id for provenance.",
		inputSchema: {
			type: "object",
			properties: {
				doc_id: { type: "string" },
				content: { type: "string" },
				chat_uuid: { type: "string" },
				mode: { type: "string", enum: ["append", "replace"] },
			},
			required: ["doc_id", "content"],
		},
	},
	{
		name: "list_doc_versions",
		description:
			"Version history of a doc (version number, author agent|human, timestamps) — how humans edited what agents wrote.",
		inputSchema: {
			type: "object",
			properties: { doc_id: { type: "string" } },
			required: ["doc_id"],
		},
	},
	{
		name: "get_doc_diff",
		description:
			"Word-level diff of one doc version vs the previous — exactly what the human changed in an agent write. Returns {parts:[{value, added?, removed?}]}.",
		inputSchema: {
			type: "object",
			properties: {
				doc_id: { type: "string" },
				version: { type: "number", description: "version number from list_doc_versions" },
			},
			required: ["doc_id", "version"],
		},
	},
	// ── Email ──
	{
		name: "list_emails",
		description:
			"List recent inbox threads (or search with q using Gmail search syntax like 'from:eric newer_than:30d'). Read before writing cold emails or follow-ups.",
		inputSchema: {
			type: "object",
			properties: { q: { type: "string" }, limit: { type: "number" } },
		},
	},
	{
		name: "get_email",
		description: "Read a full thread (all messages, plain text bodies).",
		inputSchema: {
			type: "object",
			properties: { thread_id: { type: "string", description: "emailThreads row id from list_emails" } },
			required: ["thread_id"],
		},
	},
	{
		name: "create_email_draft",
		description:
			"Create an email for Collin to review in the dashboard outbox. Read the 'Voice lessons' doc (get_doc via list_docs) FIRST — write like the corrected examples there. The human sends; you never send. Pass chat_uuid = your session id for provenance.",
		inputSchema: {
			type: "object",
			properties: {
				to: { type: "string" },
				subject: { type: "string" },
				body: { type: "string" },
				chat_uuid: { type: "string" },
				thread_id: { type: "string", description: "set for replies" },
			},
			required: ["to", "subject", "body"],
		},
	},
] as const;

// ── HTTP handler ───────────────────────────────────────────────────

export async function POST(event: APIEvent) {
	if (!(await authenticate(event.request))) {
		return json(
			{ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized — admin (memberless) API key required" } },
			401,
		);
	}

	let body: { jsonrpc?: string; id?: string | number; method?: string; params?: any };
	try {
		body = await event.request.json();
	} catch {
		return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
	}

	const id = body.id ?? null;

	switch (body.method) {
		case "initialize":
			return rpcResponse(id, {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: { listChanged: false } },
				serverInfo: { name: "madcactus-brain", version: "1.0.0" },
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
					case "get_company_memory":
						result = memoryResult(await getMemory("company"), "company");
						break;
					case "get_client_memory": {
						const company = await resolveClient(String(toolArgs.client ?? ""));
						if (!company) {
							result = { error: `no client matching "${toolArgs.client}" — call list_clients` };
							break;
						}
						result = memoryResult(await getMemory("client", company.id), `client:${company.name}`);
						break;
					}
					case "search_workspace":
						result = await searchWorkspace(String(toolArgs.query ?? ""));
						break;
					case "search_brain":
						result = await searchBrain(String(toolArgs.query ?? ""));
						break;
					case "get_recent_activity":
						result = await recentActivity(Number(toolArgs.days) || 14);
						break;
					case "list_clients": {
						const rows = await db
							.select({ id: companies.id, name: companies.name, aliases: companies.aliases })
							.from(companies)
							.orderBy(companies.name);
						result = { clients: rows };
						break;
					}
					case "create_doc": {
						const d = await createDoc(String(toolArgs.title ?? "Untitled"), toolArgs.markdown ? String(toolArgs.markdown) : "");
						result = { id: d.id, title: d.title, version: d.version };
						break;
					}
					case "list_docs":
						result = (await listDocs()).map((d) => ({
							id: d.id,
							title: d.title,
							status: d.status,
							version: d.version,
							updatedAt: d.updatedAt,
						}));
						break;
					case "get_doc": {
						const d = await getDoc(String(toolArgs.doc_id ?? ""));
						result = d
							? { id: d.id, title: d.title, status: d.status, markdown: d.markdown, version: d.version }
							: { error: "not found" };
						break;
					}
					case "write_doc":
						result = await agentWrite({
							docId: String(toolArgs.doc_id ?? ""),
							content: String(toolArgs.content ?? ""),
							chatUuid: String(toolArgs.chat_uuid ?? ""),
							mode: toolArgs.mode === "replace" ? "replace" : "append",
						});
						break;
					case "list_doc_versions":
						result = { versions: await listDocVersions(String(toolArgs.doc_id ?? "")) };
						break;
					case "get_doc_diff": {
						const diff = await getDocVersionDiff(String(toolArgs.doc_id ?? ""), Number(toolArgs.version));
						result = diff === null ? { error: "version not found" } : diff;
						break;
					}
					case "list_emails": {
						const { getPrimaryAccount, listInbox } = await import("~/lib/gmail");
						const account = await getPrimaryAccount();
						result = account
							? (await listInbox(account, { q: toolArgs.q ? String(toolArgs.q) : undefined })).slice(0, toolArgs.limit ? Number(toolArgs.limit) : 25)
							: { error: "no Gmail account connected" };
						break;
					}
					case "get_email": {
						const { getPrimaryAccount, threadWithMessages } = await import("~/lib/gmail");
						const account = await getPrimaryAccount();
						result = account
							? await threadWithMessages(account, String(toolArgs.thread_id ?? ""))
							: { error: "no Gmail account connected" };
						break;
					}
					case "create_email_draft": {
						const { createEmailDraft } = await import("~/lib/email-queries");
						result = await createEmailDraft({
							to: String(toolArgs.to ?? ""),
							subject: String(toolArgs.subject ?? ""),
							body: String(toolArgs.body ?? ""),
							chatUuid: String(toolArgs.chat_uuid ?? ""),
							threadId: toolArgs.thread_id ? String(toolArgs.thread_id) : undefined,
						});
						break;
					}
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
		server: "madcactus-brain",
		version: "1.0.0",
		protocol: PROTOCOL_VERSION,
		endpoint: "POST /api/brain-mcp",
		auth: "Authorization: Bearer mc_<admin-api-key>",
		tools: TOOLS.map((t) => t.name),
	});
}
