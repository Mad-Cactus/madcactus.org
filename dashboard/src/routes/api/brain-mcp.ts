import type { APIEvent } from "@solidjs/start/server";
import { eq, and, desc, sql } from "drizzle-orm";
import { hashKey } from "~/lib/crypto";
import { db } from "~/db";
import { apiKeys, companies } from "~/db/schema";
import { brainQuery, entityFacts } from "~/lib/brain/search";
import { brainJobs } from "~/db/schema";
import { agentWrite, createDoc, getDoc, getDocVersionDiff, listDocVersions, listDocs } from "~/lib/docs";
import { getVoiceLessons, lintVoiceText } from "~/lib/voice-lint";
import { searchWorkspace, recentActivity } from "~/lib/brain/workspace-search";
import { maybeRunCycle } from "~/lib/brain/distill";


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

// ── Tool definitions ───────────────────────────────────────────────

const TOOLS = [
	{
		name: "query",
		description:
			"CALL THIS FIRST in every session. Search the company brain: distilled entity pages, facts, conclusions, and open loops (who owes what, unanswered threads). Prefer this over re-deriving context from raw records.",
		inputSchema: {
			type: "object",
			properties: { query: { type: "string" } },
			required: ["query"],
		},
	},
	{
		name: "get_entity",
		description:
			"Full brain dossier for one client/company: distilled brief, durable facts, conclusions, open loops, and recent timeline. Use for any client-specific question.",
		inputSchema: {
			type: "object",
			properties: {
				client: { type: "string", description: "Client name (fuzzy match, aliases work)" },
			},
			required: ["client"],
		},
	},
	{
		name: "list_open_loops",
		description:
			"Open commitments and unanswered threads across all clients — what is waiting on whom.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "run_brain_cycle",
		description:
			"Start a brain refresh cycle (sync entities, detect loops, extract facts, consolidate takes) in the background. Returns { id } immediately — poll get_brain_cycle with it until status is done.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "get_brain_cycle",
		description:
			"Status of a brain cycle run: pass the id from run_brain_cycle, or call with no args for the 10 most recent runs.",
		inputSchema: {
			type: "object",
			properties: { id: { type: "string", description: "run id from run_brain_cycle" } },
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
		name: "get_recent_activity",
		description: "What changed recently across the workspace: email/doc counts, latest emails and docs, active projects, open deliverables.",
		inputSchema: {
			type: "object",
			properties: { days: { type: "number", description: "lookback window, default 14" } },
		},
	},
	{
		name: "list_clients",
		description: "List all client companies (for resolving get_entity arguments).",
		inputSchema: { type: "object", properties: {} },
	},
	// ── Voice ──
	{
		name: "get_voice_lessons",
		description:
			"Collin's voice lessons derived from his real edits. READ BEFORE writing any doc or email for him — then follow them.",
		inputSchema: {
			type: "object",
			properties: { limit: { type: "number", description: "max lessons returned, default 25" } },
		},
	},
	{
		name: "lint_voice_text",
		description:
			"Check text against Collin's voice patterns BEFORE landing it via write_doc or create_email_draft. Returns avoid-violations with the rule and fix example — fix them first; writes return the same lint back.",
		inputSchema: {
			type: "object",
			properties: { text: { type: "string" } },
			required: ["text"],
		},
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
			"Get a doc's current markdown. (Collin's voice rules are NOT docs anymore — they live in the brain: query/get_entity surfaces lessons derived from his real edits.)",
		inputSchema: {
			type: "object",
			properties: { doc_id: { type: "string" } },
			required: ["doc_id"],
		},
	},
	{
		name: "write_doc",
		description:
			"Write into a markdown doc as an attributed agent edit. mode: append (default) adds a section; replace rewrites the body. The response includes voice-lint violations — read get_voice_lessons first, fix every avoid-violation, and rewrite. Your write lands as an agent version and re-opens the doc for human review (status=draft). Pass chat_uuid = your session id for provenance.",
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
			"Create an email for Collin to review in the dashboard outbox. Read get_voice_lessons FIRST and check your text with lint_voice_text; the response includes voice-lint violations — fix every avoid-violation and resubmit. The human sends; you never send. Pass chat_uuid = your session id for provenance.",
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
					case "query":
						await maybeRunCycle();
						result = await brainQuery(String(toolArgs.query ?? ""));
						break;
					case "get_entity": {
						await maybeRunCycle();
						const company = await resolveClient(String(toolArgs.client ?? ""));
						if (!company) {
							result = { error: `no client matching "${toolArgs.client}" — call list_clients` };
							break;
						}
						const slug = company.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
						const { brainPages, brainTakes } = await import("~/db/schema");
						const [page] = await db.select().from(brainPages).where(eq(brainPages.slug, slug)).limit(1);
						const facts = await entityFacts(slug);
						const takes = page
							? await db.select({ claim: brainTakes.claim, weight: brainTakes.weight }).from(brainTakes).where(eq(brainTakes.pageId, page.id))
							: [];
						result = {
							entity: company.name,
							slug,
							brief: page?.compiledTruth ?? null,
							takes,
							facts: facts.map((f) => ({ fact: f.fact, kind: f.kind, notability: f.notability, confidence: f.confidence })),
							hint: "Use query for full-text brain search, search_workspace for raw records.",
						};
						break;
					}
					case "list_open_loops": {
						const { brainOpenLoops } = await import("~/db/schema");
						result = await db
							.select()
							.from(brainOpenLoops)
							.where(eq(brainOpenLoops.status, "open"))
							.orderBy(desc(brainOpenLoops.openedAt))
							.limit(50);
						break;
					}
					case "run_brain_cycle": {
						const { startCycle } = await import("~/routes/api/brain/cycle");
						result = await startCycle({ slack: true });
						break;
					}
					case "get_brain_cycle": {
						const cid = toolArgs.id ? String(toolArgs.id) : null;
						const runs = cid
							? await db.select().from(brainJobs).where(eq(brainJobs.id, cid)).limit(1)
							: await db.select().from(brainJobs).where(eq(brainJobs.phase, "cycle")).orderBy(desc(brainJobs.createdAt)).limit(10);
						result = runs.map((r) => ({ id: r.id, status: r.status, result: r.status === "done" ? r.payload : null, error: r.error, startedAt: r.createdAt }));
						break;
					}
					case "search_workspace":
						result = await searchWorkspace(String(toolArgs.query ?? ""));
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
					case "get_voice_lessons":
					result = await getVoiceLessons(toolArgs.limit ? Number(toolArgs.limit) : undefined);
					break;
				case "lint_voice_text":
					result = await lintVoiceText(String(toolArgs.text ?? ""));
					break;
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
