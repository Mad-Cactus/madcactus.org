import type { APIEvent } from "@solidjs/start/server";
import { and, eq, sql } from "drizzle-orm";
import { hashKey } from "~/lib/crypto";
import { db } from "~/db";
import { apiKeys } from "~/db/schema";
import {
	addPair,
	addLesson,
	addPattern,
	createDraft,
	deleteDraft,
	finalizeDraft,
	getDraft,
	lintDraft,
	listDrafts,
	listLessons,
	listPatterns,
	pendingDerivationJobs,
	promotePatterns,
	markDerivationJob,
	recentPairs,
	restoreRevision,
	saveRevision,
	search,
	showPair,
} from "~/lib/redline";
import { agentWrite, finalizeDoc, getDoc, listDocs } from "~/lib/docs";
import { createEmailDraft } from "~/lib/email-queries";

/**
 * Redline MCP Server — the learning loop for agents writing in Collin's voice.
 *
 * Stateless JSON-RPC over HTTP, same protocol as /api/mcp. Auth: MEMBERLESS
 * (admin) API key only — this is Collin's personal engine, not client-facing
 * (the mirror image of /api/mcp, which rejects memberless keys).
 *
 * Endpoint: POST /api/redline-mcp
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
	if (!keyRow || keyRow.memberId) return false; // memberless admin keys only

	db.update(apiKeys)
		.set({ lastUsedAt: new Date() })
		.where(eq(apiKeys.id, keyRow.id))
		.then(() => {})
		.catch(() => {});
	return true;
}

// ── Tool definitions ───────────────────────────────────────────────

const TOOLS = [
	{
		name: "create_draft",
		description:
			"Push a draft (email, doc section, any text) to Collin's review inbox. ALWAYS pass chat_uuid = your current session id — it ties the derived lesson back to this conversation so future lessons actually change your behavior. Lint against voice patterns BEFORE creating: call lint_text first and fix avoid-violations.",
		inputSchema: {
			type: "object",
			properties: {
				content: { type: "string", description: "The draft text" },
				title: { type: "string" },
				context: { type: "string", description: "One line: what this draft is for" },
				tags: { type: "string", description: "Comma-separated tags" },
				chat_uuid: { type: "string", description: "Your session id" },
				surface: { type: "string", enum: ["manual", "doc", "email"] },
			},
			required: ["content"],
		},
	},
	{
		name: "get_draft",
		description: "Get a draft with its full revision history (draft → human edits).",
		inputSchema: {
			type: "object",
			properties: { draft_id: { type: "string" } },
			required: ["draft_id"],
		},
	},
	{
		name: "list_drafts",
		description: "List open drafts (or all with all:true).",
		inputSchema: {
			type: "object",
			properties: { all: { type: "boolean" } },
		},
	},
	{
		name: "save_revision",
		description: "Append a revision to a draft (agent edits of its own draft).",
		inputSchema: {
			type: "object",
			properties: {
				draft_id: { type: "string" },
				content: { type: "string" },
				author: { type: "string", enum: ["agent", "human"] },
				chat_uuid: { type: "string" },
			},
			required: ["draft_id", "content"],
		},
	},
	{
		name: "restore_revision",
		description: "Restore an old revision (appends a copy; history is never destroyed).",
		inputSchema: {
			type: "object",
			properties: { draft_id: { type: "string" }, revision_id: { type: "string" } },
			required: ["draft_id", "revision_id"],
		},
	},
	{
		name: "finalize_draft",
		description:
			"Finalize a draft: first revision = agent original, latest = final, diff computed, pair stored, derivation job enqueued. Emails finalize on send; docs via the Finalize button — agents call this only when the human asked.",
		inputSchema: {
			type: "object",
			properties: { draft_id: { type: "string" } },
			required: ["draft_id"],
		},
	},
	{
		name: "delete_draft",
		description: "Delete an open draft (keeps any finalized pair).",
		inputSchema: {
			type: "object",
			properties: { draft_id: { type: "string" } },
			required: ["draft_id"],
		},
	},
	{
		name: "add_pair",
		description:
			"Store a completed (draft, final) pair directly — for text that never went through the draft inbox. Enqueues derivation.",
		inputSchema: {
			type: "object",
			properties: {
				draft_content: { type: "string" },
				final_content: { type: "string" },
				context: { type: "string" },
				tags: { type: "string" },
				chat_uuid: { type: "string" },
				surface: { type: "string", enum: ["manual", "doc", "email"] },
			},
			required: ["draft_content", "final_content"],
		},
	},
	{
		name: "show_pair",
		description: "Show a pair: draft, final, and the unified diff.",
		inputSchema: {
			type: "object",
			properties: { pair_id: { type: "string" } },
			required: ["pair_id"],
		},
	},
	{
		name: "recent_pairs",
		description: "Recent finalized (draft, final) pairs — the learning corpus.",
		inputSchema: {
			type: "object",
			properties: { limit: { type: "number" } },
		},
	},
	{
		name: "list_lessons",
		description:
			"Stored voice lessons — read these BEFORE writing anything for Collin. Filter with comma-separated tags.",
		inputSchema: {
			type: "object",
			properties: { tags: { type: "string" } },
		},
	},
	{
		name: "add_lesson",
		description: "Record a derived voice rule (usually during derivation).",
		inputSchema: {
			type: "object",
			properties: {
				pair_id: { type: "string" },
				lesson: { type: "string" },
				tags: { type: "string" },
			},
			required: ["lesson"],
		},
	},
	{
		name: "add_pattern",
		description:
			"Record a machine-checkable pattern (literal or regex, avoid/prefer). avoid-patterns that match BLOCK agent writes; prefer-patterns that are absent produce suggestions.",
		inputSchema: {
			type: "object",
			properties: {
				lesson_id: { type: "string" },
				rule: { type: "string" },
				pattern: { type: "string" },
				pattern_type: { type: "string", enum: ["literal", "regex"] },
				direction: { type: "string", enum: ["avoid", "prefer"] },
				category: { type: "string" },
				before_text: { type: "string" },
				after_text: { type: "string" },
			},
			required: ["rule", "pattern"],
		},
	},
	{
		name: "list_patterns",
		description: "All lint patterns (the machine-checkable gate rules).",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "lint_text",
		description:
			"Lint text against stored voice patterns. avoid-violations mean the write would be BLOCKED — fix them before creating drafts.",
		inputSchema: {
			type: "object",
			properties: { content: { type: "string" } },
			required: ["content"],
		},
	},
	{
		name: "search",
		description: "Search across drafts, pairs, and lessons.",
		inputSchema: {
			type: "object",
			properties: { query: { type: "string" } },
			required: ["query"],
		},
	},
	{
		name: "list_derivation_jobs",
		description:
			"Pending derivation jobs: finalized pairs with no lessons yet. The local sidecar claims these, derives lessons from the writer's pi session (chat_uuid), then records them with add_lesson/add_pattern.",
		inputSchema: {
			type: "object",
			properties: { limit: { type: "number" } },
		},
	},
	{
		name: "promote_patterns",
		description:
			"Promote unconfirmed patterns to confirmed when they appear in 3+ pairs (occurrence-based confidence).",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "complete_derivation_job",
		description:
			"Mark a derivation job done or failed (called by the local derivation sidecar after deriving lessons).",
		inputSchema: {
			type: "object",
			properties: {
				job_id: { type: "string" },
				status: { type: "string", enum: ["done", "failed"] },
				error: { type: "string" },
			},
			required: ["job_id", "status"],
		},
	},
	// ── Docs (CRDT markdown) ──
	{
		name: "list_docs",
		description: "List markdown docs (id, title, version, updatedAt).",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "get_doc",
		description: "Get a doc's current markdown.",
		inputSchema: {
			type: "object",
			properties: { doc_id: { type: "string" } },
			required: ["doc_id"],
		},
	},
	{
		name: "gated_write_doc",
		description:
			"Write into a markdown doc as an attributed agent edit. Linted against voice patterns first; avoid-violations BLOCK the write (fix and retry, or force:true only if the human asked for exactly this phrasing). Pass chat_uuid = your session id so the derived lesson ties back to this conversation. mode: append (default) adds a new section; replace rewrites the body.",
		inputSchema: {
			type: "object",
			properties: {
				doc_id: { type: "string" },
				content: { type: "string" },
				chat_uuid: { type: "string" },
				mode: { type: "string", enum: ["append", "replace"] },
				force: { type: "boolean" },
			},
			required: ["doc_id", "content"],
		},
	},
	{
		name: "finalize_doc",
		description:
			"Finalize a doc after the human edited it: (your last gated write) vs (current markdown) becomes a learning pair, derivation is enqueued. Only call when the human asked.",
		inputSchema: {
			type: "object",
			properties: { doc_id: { type: "string" } },
			required: ["doc_id"],
		},
	},
	// ── Email ──
	{
		name: "list_emails",
		description:
			"List recent inbox threads (or search with q using Gmail search syntax like 'from:eric newer_than:30d'). The company brain: read before writing cold emails or follow-ups.",
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
			"Create an email for Collin to review in the dashboard outbox. Body is linted against voice lessons FIRST: the tool returns blocked:true with violations if you used phrasing he has corrected before — fix and retry (never force). Pass chat_uuid = your session id so edits derive into lessons for you. The human sends; you never send.",
		inputSchema: {
			type: "object",
			properties: {
				to: { type: "string" },
				subject: { type: "string" },
				body: { type: "string" },
				chat_uuid: { type: "string" },
				thread_id: { type: "string", description: "set for replies" },
				context: { type: "string" },
			},
			required: ["to", "subject", "body"],
		},
	},
];

// ── Dispatch ───────────────────────────────────────────────────────

export const POST = async (event: APIEvent) => {
	if (!(await authenticate(event.request))) {
		return json({ error: "Unauthorized" }, 401);
	}

	let body: {
		id?: string | number | null;
		method?: string;
		params?: { name?: string; arguments?: Record<string, any> };
	};
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
				serverInfo: { name: "madcactus-redline", version: "1.0.0" },
			});

		case "notifications/initialized":
			return new Response(null, { status: 202 });

		case "tools/list":
			return rpcResponse(id, { tools: TOOLS });

		case "tools/call": {
			const toolName = body.params?.name;
			const a = body.params?.arguments ?? {};
			try {
				let result: unknown;
				switch (toolName) {
					case "create_draft":
						result = await createDraft({
							content: String(a.content),
							title: a.title ? String(a.title) : undefined,
							context: a.context ? String(a.context) : undefined,
							tags: a.tags ? String(a.tags) : undefined,
							chatUuid: a.chat_uuid ? String(a.chat_uuid) : undefined,
							surface: (a.surface as "manual" | "doc" | "email") ?? undefined,
						});
						break;
					case "get_draft":
						result = await getDraft(String(a.draft_id));
						break;
					case "list_drafts":
						result = await listDrafts(Boolean(a.all));
						break;
					case "save_revision":
						await saveRevision(
							String(a.draft_id),
							String(a.content),
							a.author === "human" ? "human" : "agent",
							a.chat_uuid ? String(a.chat_uuid) : undefined,
						);
						result = { ok: true };
						break;
					case "restore_revision":
						await restoreRevision(String(a.draft_id), String(a.revision_id));
						result = { ok: true };
						break;
					case "finalize_draft":
						result = { pair_id: await finalizeDraft(String(a.draft_id)) };
						break;
					case "delete_draft":
						await deleteDraft(String(a.draft_id));
						result = { ok: true };
						break;
					case "add_pair":
						result = await addPair({
							draftContent: String(a.draft_content),
							finalContent: String(a.final_content),
							context: a.context ? String(a.context) : undefined,
							tags: a.tags ? String(a.tags) : undefined,
							chatUuid: a.chat_uuid ? String(a.chat_uuid) : undefined,
							surface: (a.surface as "manual" | "doc" | "email") ?? undefined,
						});
						break;
					case "show_pair":
						result = await showPair(String(a.pair_id));
						break;
					case "recent_pairs":
						result = await recentPairs(a.limit ? Number(a.limit) : 20);
						break;
					case "list_lessons":
						result = await listLessons(a.tags ? String(a.tags) : undefined);
						break;
					case "add_lesson":
						result = await addLesson({
							pairId: a.pair_id ? String(a.pair_id) : undefined,
							lesson: String(a.lesson),
							tags: a.tags ? String(a.tags) : undefined,
						});
						break;
					case "add_pattern":
						result = await addPattern({
							lessonId: a.lesson_id ? String(a.lesson_id) : undefined,
							rule: String(a.rule),
							pattern: String(a.pattern),
							patternType: a.pattern_type === "regex" ? "regex" : "literal",
							direction: a.direction === "prefer" ? "prefer" : "avoid",
							category: a.category ? String(a.category) : undefined,
							beforeText: a.before_text ? String(a.before_text) : undefined,
							afterText: a.after_text ? String(a.after_text) : undefined,
						});
						break;
					case "list_patterns":
						result = await listPatterns();
						break;
					case "lint_text": {
						const violations = await lintDraft(String(a.content));
						result = {
							blocked: violations.some((v) => v.direction === "avoid"),
							violations,
						};
						break;
					}
					case "search":
						result = await search(String(a.query));
						break;
					case "list_derivation_jobs":
						result = await pendingDerivationJobs(a.limit ? Number(a.limit) : 10);
						break;
					case "promote_patterns":
						result = { promoted: await promotePatterns() };
						break;
					case "complete_derivation_job":
						await markDerivationJob(
							String(a.job_id),
							a.status === "failed" ? "failed" : "done",
							a.error ? String(a.error) : undefined,
						);
						result = { ok: true };
						break;
					case "list_docs":
						result = (await listDocs()).map((d) => ({
							id: d.id,
							title: d.title,
							version: d.version,
							updatedAt: d.updatedAt,
						}));
						break;
					case "get_doc": {
						const d = await getDoc(String(a.doc_id));
						result = d ? { id: d.id, title: d.title, markdown: d.markdown, version: d.version } : { error: "not found" };
						break;
					}
					case "gated_write_doc":
						result = await agentWrite({
							docId: String(a.doc_id),
							content: String(a.content),
							chatUuid: String(a.chat_uuid ?? ""),
							mode: a.mode === "replace" ? "replace" : "append",
							force: Boolean(a.force),
						});
						break;
					case "finalize_doc":
						result = { pair_id: await finalizeDoc(String(a.doc_id)) };
						break;
					case "list_emails": {
						const { getPrimaryAccount, listInbox } = await import("~/lib/gmail");
						const account = await getPrimaryAccount();
						result = account
							? (await listInbox(account, { q: a.q ? String(a.q) : undefined })).slice(0, a.limit ? Number(a.limit) : 25)
							: { error: "no Gmail account connected" };
						break;
					}
					case "get_email": {
						const { getPrimaryAccount, threadWithMessages } = await import("~/lib/gmail");
						const account = await getPrimaryAccount();
						result = account
							? await threadWithMessages(account, String(a.thread_id))
							: { error: "no Gmail account connected" };
						break;
					}
					case "create_email_draft":
						result = await createEmailDraft({
							to: String(a.to),
							subject: String(a.subject),
							body: String(a.body),
							chatUuid: String(a.chat_uuid ?? ""),
							threadId: a.thread_id ? String(a.thread_id) : undefined,
							context: a.context ? String(a.context) : undefined,
						});
						break;
					default:
						return rpcError(id, -32601, `Unknown tool: ${toolName}`);
				}
				return rpcResponse(id, {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				});
			} catch (err) {
				return rpcError(
					id,
					-32603,
					`Tool execution error: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}

		case "ping":
			return rpcResponse(id, {});

		default:
			return rpcError(id, -32601, `Method not found: ${body.method}`);
	}
};

export function OPTIONS() {
	return new Response(null, {
		status: 204,
		headers: {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, Authorization",
		},
	});
}
