import type { APIEvent } from "@solidjs/start/server";
import { eq, and, desc, inArray, sql, ilike } from "drizzle-orm";
import { hashKey } from "~/lib/crypto";
import { db } from "~/db";
import { apiKeys, companies, outreachProspects, OUTREACH_STAGES } from "~/db/schema";
import { brainQuery, entityFacts } from "~/lib/brain/search";
import { brainJobs, docs, shortLinks } from "~/db/schema";
import { agentWrite, createDoc, getDoc, getDocVersionDiff, listDocVersions, listDocs, renameDoc, setDocAppendix } from "~/lib/docs";
import { getVoiceLessons, hasRecentLessonReview, lintGateError, lintVoiceText, listKnownGenres, recordLessonReview, topLessonsForText } from "~/lib/voice-lint-db";
import { docSurface, type VoiceScope } from "~/lib/voice-lint";
import { searchWorkspace, recentActivity } from "~/lib/brain/workspace-search";
import { randomKey, shortLinkBase, TARGET_RE } from "~/lib/short-links";
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

const SURFACES = ["email", "docs", "post", "newsletter"] as const;

/** scope args from a tool call — invalid surface/genre ignored, not fatal */
function toolScope(toolArgs: Record<string, unknown>): VoiceScope | undefined {
	const surface = SURFACES.includes(toolArgs.surface as (typeof SURFACES)[number]) ? String(toolArgs.surface) : undefined;
	const genre = toolArgs.genre ? String(toolArgs.genre).trim().toLowerCase() : undefined;
	return surface ? { surface, genre: genre ?? null } : undefined;
}

/** Genre vocabulary gate: agents must REUSE an existing genre or explicitly
 *  mint a new one (confirm_new_genre=true). Without the gate, typo'd
 *  near-duplicates ("promo" vs "marketing") fragment the voice scopes into
 *  islands that lint nothing together. */
async function gateGenre(
	toolArgs: Record<string, unknown>,
): Promise<{ error: string; known_genres: string[] } | { genre: string | null }> {
	const raw = toolArgs.genre;
	if (raw === undefined || raw === null || String(raw).trim() === "") return { genre: null };
	const g = String(raw).trim().toLowerCase();
	if (toolArgs.confirm_new_genre === true) return { genre: g };
	const known = await listKnownGenres();
	if (known.includes(g)) return { genre: g };
	return {
		error: `genre "${g}" is not in the vocabulary. REUSE a known_genre if one fits (preferred), or re-call with confirm_new_genre=true to mint "${g}" deliberately.`,
		known_genres: known,
	};
}

/** Lessons-for-text gate (the "auto-no"): an agent's first attempt at a write
 *  bounces with the voice lessons ranked for exactly that text — the lessons
 *  arrive when they matter, next to the draft, not as a pre-read blob. Sign-off
 *  is lessons_applied=true on the resubmit. Pulling get_voice_lessons this hour
 *  (lessons_reviewed + chat_uuid) also passes — both paths put lessons in
 *  context before text lands. */
async function gateLessonsForText(
	toolArgs: Record<string, unknown>,
	text: string,
	scope: VoiceScope,
): Promise<
	| { ok: true }
	| { ok: false; blocked: "lessons_for_text"; lessons: Awaited<ReturnType<typeof topLessonsForText>>; error: string }
> {
	const chatUuid = toolArgs.chat_uuid ? String(toolArgs.chat_uuid).trim() : "";
	if (toolArgs.lessons_applied === true) return { ok: true };
	if (toolArgs.lessons_reviewed === true && chatUuid && (await hasRecentLessonReview(chatUuid))) return { ok: true };
	return {
		ok: false as const,
		blocked: "lessons_for_text" as const,
		lessons: await topLessonsForText(text, scope),
		error:
			"blocked (auto-no): these are Collin's voice lessons ranked for YOUR text — apply the relevant ones, rewrite what they change, then resubmit with lessons_applied=true. Lint rejections also carry the lesson behind each violated rule.",
	};
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
	// ── Outreach prospects (brain wiring) ──
	{
		name: "list_outreach",
		description:
			"List outreach prospects with their brain wiring: brain_url, activity key, and video_url. Use to check which prospect a brain belongs to, to read the current activity key before updating it, or to see which prospects have outreach videos linked.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "set_outreach_brain",
		description:
			'Create or update an outreach prospect\'s brain wiring. Matches by company (case-insensitive; creates the prospect if unknown). Set brain_url (e.g. https://<name>.madcactus.org) and brain_activity_key (the brain\'s ACTIVITY_KEY) so the dashboard can pull /activity. Set video_url to the CAP share link once the outreach video is recorded (the dashboard then serves the tracked /v/:id email link). Omit brain_activity_key / video_url to leave them unchanged. Omit stage to leave it unchanged; stages: ' + OUTREACH_STAGES.join(" → ") + ".",
		inputSchema: {
			type: "object",
			properties: {
				company: { type: "string", description: "prospect company name (matched case-insensitively)" },
				brain_url: { type: "string" },
				brain_activity_key: { type: "string", description: "omit to leave the existing key unchanged" },
				video_url: { type: "string", description: "CAP share URL for the outreach video; empty string clears it" },
				video_description: { type: "string", description: "what the video shows / why it exists; shown in the dashboard" },
				stage: { type: "string", enum: [...OUTREACH_STAGES], description: "omit to leave unchanged" },
				contact_name: { type: "string" },
				email: { type: "string" },
				notes: { type: "string" },
			},
			required: ["company"],
		},
	},
	// ── Voice ──
	{
		name: "get_voice_lessons",
		description:
			"Collin's voice lessons derived from his real edits. REQUIRED before any doc write: pass chat_uuid (your session id) — doc writes (write_doc/create_doc/create_post/create_newsletter) are REJECTED unless this was called with the same chat_uuid within the last hour AND the write carries lessons_reviewed=true. Also pass surface (email|docs|post|newsletter) and genre to get the rules that apply to exactly what you're writing plus the global ones. Returns the top 10 by confidence — the write-time auto-no returns lessons ranked for your specific text instead. known_genres lists the genre vocabulary — REUSE an existing genre instead of inventing near-duplicates.",
		inputSchema: {
			type: "object",
			properties: {
				limit: { type: "number", description: "max lessons returned, default 25" },
				surface: { type: "string", enum: ["email", "docs", "post", "newsletter"], description: "what you are writing — scopes the lessons" },
				genre: { type: "string", description: "freeform subtype within the surface, e.g. marketing|informational|casual — match an existing genre spelling" },
				topic: { type: "string", enum: ["subject", "cta"], description: "fetch only subject- or CTA-learnings — REQUIRED before drafting a newsletter subject or CTA copy" },
				chat_uuid: { type: "string", description: "Your session id — records the lessons review that doc writes gate on. Pass it every time." },
			},
		},
	},
	{
		name: "lint_voice_text",
		description:
			"Check text against Collin's voice patterns BEFORE landing it via write_doc or create_email_draft. Pass surface/genre matching what the text is (post, newsletter, email, plain doc) so only the rules learned for that kind apply. Returns avoid-violations with the rule and fix example — fix them first; writes return the same lint back.",
		inputSchema: {
			type: "object",
			properties: {
				text: { type: "string" },
				surface: { type: "string", enum: ["email", "docs", "post", "newsletter"] },
				genre: { type: "string" },
			},
			required: ["text"],
		},
	},
	{
		name: "lint_voice_check",
		description:
			"One-off voice check for ANY text — no doc, no write, no gates. Returns the avoid-violations (with rule + fix example) AND the top 10 voice lessons ranked for exactly this text. The loop: call this, fix what the violations and lessons flag, call again, and only use the text elsewhere once it comes back clean. Same judgment a write-time auto-no gives, available standalone. Requires surface (email|docs|post|newsletter) so the right rules apply.",
		inputSchema: {
			type: "object",
			properties: {
				text: { type: "string" },
				surface: { type: "string", enum: ["email", "docs", "post", "newsletter"], description: "what the text is — scopes rules and lessons" },
				genre: { type: "string", description: "freeform subtype, match an existing genre spelling" },
			},
			required: ["text", "surface"],
		},
	},
	// ── Docs ──
	{
		name: "create_doc",
		description:
			"Create a plain internal markdown doc (kind=null — NOT a post/newsletter; use create_post/create_newsletter for those) and return its id. doc ids are UUIDs — use this when list_docs has no fitting doc before write_doc. The body is voice-linted BEFORE creation: any avoid-violation REJECTS the call — fix the flagged text and resubmit (no override; if a rule is wrong, tell Collin to disable it). First write attempt auto-no's: the call bounces with the top voice lessons ranked for YOUR text — apply them, then resubmit with lessons_applied=true. Alternatively pass lessons_reviewed=true after get_voice_lessons with your chat_uuid (within 1h).",
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string" },
				markdown: { type: "string", description: "Optional initial body — must pass voice lint (zero avoid-violations) or the call is rejected." },
				genre: { type: "string", description: "Freeform subtype (marketing|informational|…) — scopes the voice rules. MUST be an existing genre from get_voice_lessons known_genres; new ones need confirm_new_genre=true." },
				confirm_new_genre: { type: "boolean", description: "Set true only when no existing genre fits — mints this genre into the vocabulary." },
				lessons_applied: { type: "boolean", description: "true = you read the lessons returned by the auto-no (or get_voice_lessons) and this text applies them. Required on resubmit." },
lessons_reviewed: { type: "boolean", description: "true = you called get_voice_lessons with this chat_uuid, read the lessons, and this text follows them. Required." },
				chat_uuid: { type: "string", description: "Your session id — must match the chat_uuid used for get_voice_lessons." },
			},
			required: ["title", "lessons_reviewed", "chat_uuid"],
		},
	},
	{
		name: "create_post",
		description:
			"Create a LinkedIn post draft (kind=post). Read get_voice_lessons with surface=post and your chat_uuid first. HARD GATES: the call is REJECTED if the body has any avoid-violation (fix and resubmit — no override). First write attempt auto-no's: the call bounces with the top voice lessons ranked for YOUR text — apply them, then resubmit with lessons_applied=true. Collin previews, edits, and schedules it in the dashboard; you never schedule or publish. Drafts only.",
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string", description: "Internal title — the post body is the markdown." },
				markdown: { type: "string", description: "Post body — plain markdown, no headings; it renders as LinkedIn text. Must pass voice lint (zero avoid-violations)." },
				genre: { type: "string", description: "Freeform subtype, e.g. marketing|casual|story — MUST reuse an existing genre from get_voice_lessons known_genres; new ones need confirm_new_genre=true." },
				confirm_new_genre: { type: "boolean", description: "Set true only when no existing genre fits — mints this genre into the vocabulary." },
				lessons_applied: { type: "boolean", description: "true = you read the lessons returned by the auto-no (or get_voice_lessons) and this text applies them. Required on resubmit." },
lessons_reviewed: { type: "boolean", description: "true = you called get_voice_lessons with this chat_uuid, read the lessons, and this text follows them. Required." },
				chat_uuid: { type: "string", description: "Your session id — must match the chat_uuid used for get_voice_lessons." },
			},
			required: ["title", "markdown", "lessons_reviewed", "chat_uuid"],
		},
	},
	{
		name: "create_newsletter",
		description:
			"Create a Cactus Dispatch newsletter issue draft (kind=newsletter). The doc title IS the email subject — set a real subject as the title (or refine it after with set_newsletter_subject). Read get_voice_lessons with surface=newsletter and your chat_uuid first — fetch topic=subject AND topic=cta lessons too (subject and CTA have their own learnings). HARD GATES: the call is REJECTED if the body has any avoid-violation (fix and resubmit — no override). First write attempt auto-no's: the call bounces with the top voice lessons ranked for YOUR text — apply them, then resubmit with lessons_applied=true. Channel CTA copy goes through set_channel_appendix (never in the body markdown). Collin previews (email + web), edits, and schedules it; you never send. Drafts only.",
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string", description: "The email subject / issue headline — doubles as the subject line" },
				markdown: { type: "string", description: "Issue body prose — no Subject: line, no CTA block (use set_channel_appendix). Must pass voice lint (zero avoid-violations)." },
				genre: { type: "string", description: "Freeform subtype, e.g. marketing|informational — MUST reuse an existing genre from get_voice_lessons known_genres; new ones need confirm_new_genre=true." },
				confirm_new_genre: { type: "boolean", description: "Set true only when no existing genre fits — mints this genre into the vocabulary." },
				lessons_applied: { type: "boolean", description: "true = you read the lessons returned by the auto-no (or get_voice_lessons) and this text applies them. Required on resubmit." },
lessons_reviewed: { type: "boolean", description: "true = you called get_voice_lessons with this chat_uuid, read the lessons, and this text follows them. Required." },
				chat_uuid: { type: "string", description: "Your session id — must match the chat_uuid used for get_voice_lessons." },
			},
			required: ["title", "markdown", "lessons_reviewed", "chat_uuid"],
		},
	},
	{
		name: "set_newsletter_subject",
		description:
			'Set the subject line of a newsletter issue (kind=newsletter). The doc title IS the subject — this renames the doc, and the same text becomes the email subject and the web headline. Never put the subject in the body markdown. Runs Collin\'s voice lint on the subject and returns warnings (advisory — the subject lands regardless); fix flagged wording before or after, Collin reviews in the dashboard.',
		inputSchema: {
			type: "object",
			properties: {
				doc_id: { type: "string" },
				subject: { type: "string", description: "The email subject line / issue title" },
			},
			required: ["doc_id", "subject"],
		},
	},
	{
		name: "set_channel_appendix",
		description:
			'Set the AFTER-THE-BODY copy (CTA block) of a newsletter issue for one channel — channel: "email" or "web". This is the ONLY place channel-specific copy goes; never write channel CTAs into the body markdown. New issues already carry the default /brain CTA here — overwrite it only when Collin asks for different copy. Runs Collin\'s voice lint (surface=newsletter) and returns warnings (advisory — the copy lands regardless).',
		inputSchema: {
			type: "object",
			properties: {
				doc_id: { type: "string" },
				channel: { type: "string", enum: ["email", "web"] },
				content: { type: "string", description: "markdown rendered after the issue body" },
			},
			required: ["doc_id", "channel", "content"],
		},
	},
	{
		name: "list_docs",
		description:
			"List markdown docs (id, title, kind, genre, status, version, updatedAt). status=draft means an agent write awaits human review. Pass kind=post|newsletter|docs (docs = plain) to filter.",
		inputSchema: {
			type: "object",
			properties: { kind: { type: "string", enum: ["post", "newsletter", "docs"] } },
		},
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
			"Write into a markdown doc as an attributed agent edit. mode: append (default) adds a section; replace rewrites the body. HARD GATES: the write is REJECTED (nothing lands) if the text has any avoid-violation — fix and resubmit; no override exists, if a rule is wrong tell Collin to disable it — First write attempt auto-no's: the call bounces with the top voice lessons ranked for YOUR text — apply them, then resubmit with lessons_applied=true. On success the write lands as an agent version and re-opens the doc for human review (status=draft). Pass genre to tag/retag the doc (marketing|informational|casual…) so its edits teach and lint under the right scope — reuse an existing genre from get_voice_lessons known_genres.",
		inputSchema: {
			type: "object",
			properties: {
				doc_id: { type: "string" },
				content: { type: "string", description: "Must pass voice lint (zero avoid-violations scoped to the doc's kind+genre) or the write is rejected." },
				chat_uuid: { type: "string", description: "Your session id — must match the chat_uuid used for get_voice_lessons." },
				lessons_applied: { type: "boolean", description: "true = you read the lessons returned by the auto-no (or get_voice_lessons) and this text applies them. Required on resubmit." },
lessons_reviewed: { type: "boolean", description: "true = you called get_voice_lessons with this chat_uuid, read the lessons, and this text follows them. Required." },
				mode: { type: "string", enum: ["append", "replace"] },
				genre: { type: "string", description: "Tag/retag the doc — scopes which voice rules lint it and which lessons its edits teach. MUST reuse an existing genre; new ones need confirm_new_genre=true." },
				confirm_new_genre: { type: "boolean", description: "Set true only when no existing genre fits — mints this genre into the vocabulary." },
			},
			required: ["doc_id", "content", "lessons_reviewed", "chat_uuid"],
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
	// ── Short links ──
	{
		name: "create_short_link",
		description:
			"Create a tracked short link /l/<slug> that 302s to target and counts every human click (bots/prefetchers are filtered) — click-through tracking for social posts, lead magnets, etc. Put UTM params in target; the shared link stays clean. The slug is a generated unguessable key (never chosen) — call list_short_links first to see existing links, or to report CTR per link/post. Pass doc_id when the link ships inside a specific post/newsletter — that ties clicks to the doc for conversion attribution. Returns the ready-to-share url.",
		inputSchema: {
			type: "object",
			properties: {
				target: { type: "string", description: "Destination URL, must start with http(s):// — UTM params go here" },
				doc_id: { type: "string", description: "Optional: docs.id of the post/newsletter this link ships in — attaches the link for per-doc click attribution" },
			},
			required: ["target"],
		},
	},
	{
		name: "list_short_links",
		description:
			"All short links with click counts (human clicks only) and the attached post/newsletter when set, most-clicked first. Read before create_short_link to check for an existing slug, or to report CTR per link/post.",
		inputSchema: { type: "object", properties: {} },
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
			"Create an email for Collin to review in the dashboard Drafts tab. Read get_voice_lessons FIRST and pre-check with lint_voice_text (surface=email). HARD GATE: any avoid-violation REJECTS the call before anything is saved — fix the flagged text and resubmit; nothing lands until it's clean. First write attempt auto-no's: the call bounces with the top voice lessons ranked for YOUR text — apply them, then resubmit with lessons_applied=true. To revise a draft you already created, pass its draft_id (same fields) instead of creating a new one. The human sends; you never send. Pass chat_uuid = your session id for provenance.",
		inputSchema: {
			type: "object",
			properties: {
				to: { type: "string" },
				cc: { type: "string", description: "comma-separated Cc addresses" },
				bcc: { type: "string", description: "comma-separated Bcc addresses" },
				subject: { type: "string" },
				body: { type: "string" },
				draft_id: { type: "string", description: "outbox id from a previous create_email_draft — updates that draft in place instead of creating a new one" },
				lessons_applied: { type: "boolean", description: "true = you read the lessons returned by the auto-no (or get_voice_lessons) and this text applies them. Required on resubmit." },
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
						const { startCycle } = await import("~/lib/brain/cycle-runner");
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
					case "list_outreach":
						result = await db
							.select({
								id: outreachProspects.id,
								company: outreachProspects.company,
								stage: outreachProspects.stage,
								contactName: outreachProspects.contactName,
								email: outreachProspects.email,
								videoUrl: outreachProspects.videoUrl,
								videoDescription: outreachProspects.videoDescription,
								brainUrl: outreachProspects.brainUrl,
								brainActivityKey: outreachProspects.brainActivityKey,
							})
							.from(outreachProspects)
							.orderBy(outreachProspects.company);
						break;
					case "set_outreach_brain": {
						const company = String(toolArgs.company ?? "").trim();
						if (!company) {
							result = { error: "company is required" };
							break;
						}
						const brainUrl = String(toolArgs.brain_url ?? "").trim() || null;
						const activityKey = String(toolArgs.brain_activity_key ?? "").trim();
						const videoUrl = toolArgs.video_url !== undefined ? String(toolArgs.video_url).trim() || null : null;
						const videoDescription =
							toolArgs.video_description !== undefined ? String(toolArgs.video_description).trim() || null : null;
						let stage: string | null = null;
						if (toolArgs.stage !== undefined) {
							stage = String(toolArgs.stage);
							if (!(OUTREACH_STAGES as readonly string[]).includes(stage)) {
								result = { error: `unknown stage "${stage}" — valid: ${OUTREACH_STAGES.join(", ")}` };
								break;
							}
						}
						const [existing] = await db
							.select({ id: outreachProspects.id })
							.from(outreachProspects)
							.where(ilike(outreachProspects.company, company))
							.limit(1);
						if (existing) {
							await db
								.update(outreachProspects)
								.set({
									...(brainUrl !== null ? { brainUrl } : {}),
									...(activityKey ? { brainActivityKey: activityKey } : {}),
									...(toolArgs.video_url !== undefined ? { videoUrl } : {}),
									...(toolArgs.video_description !== undefined ? { videoDescription } : {}),
									...(stage ? { stage } : {}),
									...(toolArgs.contact_name ? { contactName: String(toolArgs.contact_name) } : {}),
									...(toolArgs.email ? { email: String(toolArgs.email) } : {}),
									...(toolArgs.notes ? { notes: String(toolArgs.notes) } : {}),
								})
								.where(eq(outreachProspects.id, existing.id));
							result = { id: existing.id, company, updated: true };
						} else {
							const [created] = await db
								.insert(outreachProspects)
								.values({
									company,
									brainUrl,
									brainActivityKey: activityKey || null,
									videoUrl,
									videoDescription,
									...(stage ? { stage } : {}),
									contactName: toolArgs.contact_name ? String(toolArgs.contact_name) : null,
									email: toolArgs.email ? String(toolArgs.email) : null,
									notes: toolArgs.notes ? String(toolArgs.notes) : null,
								})
								.returning({ id: outreachProspects.id });
							result = { id: created.id, company, created: true };
						}
						break;
					}
				case "get_voice_lessons": {
					const scope = toolScope(toolArgs);
					const topic = toolArgs.topic === "subject" || toolArgs.topic === "cta" ? toolArgs.topic : undefined;
					// the lessons gate marker: a doc write from this chat is only accepted
					// within 1h of this call (and with lessons_reviewed=true on the write)
					if (toolArgs.chat_uuid) await recordLessonReview(String(toolArgs.chat_uuid));
					result = {
						lessons: await getVoiceLessons(toolArgs.limit ? Number(toolArgs.limit) : undefined, scope, topic),
						known_genres: await listKnownGenres(),
					};
					break;
				}
				case "lint_voice_text": {
					const scope = toolScope(toolArgs);
					result = await lintVoiceText(String(toolArgs.text ?? ""), scope);
					break;
				}
				case "lint_voice_check": {
					const scope = toolScope(toolArgs);
					if (!scope) {
						result = { error: "surface is required (email|docs|post|newsletter) — rules and lessons are scoped per surface." };
						break;
					}
					const text = String(toolArgs.text ?? "");
					result = {
						lint: await lintVoiceText(text, scope),
						top_lessons: (await topLessonsForText(text, scope)).slice(0, 10),
						known_genres: await listKnownGenres(),
					};
					break;
				}
				case "create_doc": {
					const gate = await gateGenre(toolArgs);
					if ("error" in gate) {
						result = gate;
						break;
					}
					const docMarkdown = toolArgs.markdown ? String(toolArgs.markdown) : "";
					const lessons = await gateLessonsForText(toolArgs, docMarkdown, { surface: "docs", genre: gate.genre ?? null });
					if (!lessons.ok) {
						result = lessons;
						break;
					}
					const docLint = await lintVoiceText(docMarkdown, { surface: "docs", genre: gate.genre ?? null });
					if (docLint.avoidCount > 0) {
						result = lintGateError(docLint);
						break;
					}
					const d = await createDoc(String(toolArgs.title ?? "Untitled"), docMarkdown, {
						author: "agent",
						chatUuid: toolArgs.chat_uuid ? String(toolArgs.chat_uuid) : undefined,
						genre: gate.genre,
					});
					result = { id: d.id, title: d.title, version: d.version, kind: null, genre: d.genre, lint: docLint };
					break;
				}
				case "create_post":
				case "create_newsletter": {
					const gate = await gateGenre(toolArgs);
					if ("error" in gate) {
						result = gate;
						break;
					}
					const kind = toolName === "create_post" ? ("post" as const) : ("newsletter" as const);
					const markdown = String(toolArgs.markdown ?? "");
					const lessons = await gateLessonsForText(toolArgs, markdown, { surface: kind, genre: gate.genre ?? null });
					if (!lessons.ok) {
						result = lessons;
						break;
					}
					// hard gate: reject BEFORE the doc exists — no advisory landing
					const lint = await lintVoiceText(markdown, { surface: kind, genre: gate.genre ?? null });
					if (lint.avoidCount > 0) {
						result = lintGateError(lint);
						break;
					}
					const d = await createDoc(String(toolArgs.title ?? "Untitled"), markdown, {
						author: "agent",
						kind,
						genre: gate.genre,
						chatUuid: toolArgs.chat_uuid ? String(toolArgs.chat_uuid) : undefined,
					});
					result = { id: d.id, title: d.title, kind, genre: d.genre, version: d.version, status: d.status, lint };
					break;
				}
				case "list_docs": {
					const kind = toolArgs.kind === "post" || toolArgs.kind === "newsletter" ? toolArgs.kind : null;
					result = (await listDocs())
						.filter((d) => (toolArgs.kind === "docs" ? d.kind === null : kind ? d.kind === kind : true))
						.map((d) => ({
							id: d.id,
							title: d.title,
							kind: d.kind,
							genre: d.genre,
							status: d.status,
							version: d.version,
							updatedAt: d.updatedAt,
						}));
					break;
				}
					case "get_doc": {
						const d = await getDoc(String(toolArgs.doc_id ?? ""));
						result = d
							? { id: d.id, title: d.title, status: d.status, markdown: d.markdown, version: d.version }
							: { error: "not found" };
						break;
					}
					case "write_doc": {
						const gate = await gateGenre(toolArgs);
						if ("error" in gate) {
							result = gate;
							break;
						}
						const content = String(toolArgs.content ?? "");
						const [targetDoc] = await db
							.select({ kind: docs.kind, genre: docs.genre })
							.from(docs)
							.where(eq(docs.id, String(toolArgs.doc_id ?? "")))
							.limit(1);
						const lessons = await gateLessonsForText(toolArgs, content, {
							surface: targetDoc ? docSurface(targetDoc.kind) : "docs",
							genre: gate.genre ?? targetDoc?.genre ?? null,
						});
						if (!lessons.ok) {
							result = lessons;
							break;
						}
						// agentWrite runs the hard lint gate itself: lint before save,
						// rejected writes leave the doc untouched
						result = await agentWrite({
							docId: String(toolArgs.doc_id ?? ""),
							content: String(toolArgs.content ?? ""),
							chatUuid: String(toolArgs.chat_uuid ?? ""),
							mode: toolArgs.mode === "replace" ? "replace" : "append",
							genre: gate.genre ?? undefined,
						});
					}
						break;
					case "set_newsletter_subject": {
						const d = await getDoc(String(toolArgs.doc_id ?? ""));
						if (!d) {
							result = { error: "not found" };
							break;
						}
						if (d.kind !== "newsletter") {
							result = { error: `doc ${d.id} is not a newsletter (kind=${d.kind}) — the subject only exists for issues` };
							break;
						}
						const subject = String(toolArgs.subject ?? "").trim();
						if (!subject) {
							result = { error: "subject is required" };
							break;
						}
						// the title IS the subject — rename is the whole write. Subject lint
						// is advisory: a subject is a fragment, not body prose, so warnings
						// never block the rename.
						const warnings = (await lintVoiceText(subject, { surface: "newsletter" })).violations;
						await renameDoc(d.id, subject);
						result = { id: d.id, subject, lint_warnings: warnings };
						break;
					}
					case "set_channel_appendix": {
						const d = await getDoc(String(toolArgs.doc_id ?? ""));
						if (!d) {
							result = { error: "not found" };
							break;
						}
						if (d.kind !== "newsletter") {
							result = { error: `doc ${d.id} is not a newsletter (kind=${d.kind}) — channel appendix only exists for issues` };
							break;
						}
						const channel = toolArgs.channel === "email" || toolArgs.channel === "web" ? toolArgs.channel : null;
						if (!channel) {
							result = { error: 'channel must be "email" or "web"' };
							break;
						}
						const content = String(toolArgs.content ?? "");
						// advisory lint — channel copy lands either way, Collin reviews
						const warnings = content.trim()
							? (await lintVoiceText(content, { surface: "newsletter" })).violations
							: [];
						await setDocAppendix(d.id, channel, content);
						result = { id: d.id, channel, lint_warnings: warnings };
						break;
					}
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
						// hard gate BEFORE insert: a lint-failing draft never lands, so retries
						// can't pile up duplicate outbox rows (the 3-drafts bug). Revisions of
						// an already-landed draft go through draft_id instead of a new row.
						const { createEmailDraft, updateEmailDraft } = await import("~/lib/email-outbox");
						const draftBody = String(toolArgs.body ?? "");
						const lessons = await gateLessonsForText(toolArgs, draftBody, { surface: "email", genre: null });
						if (!lessons.ok) {
							result = lessons;
							break;
						}
						const draftLint = await lintVoiceText(draftBody, { surface: "email" });
						if (draftLint.avoidCount > 0) {
							result = lintGateError(draftLint);
							break;
						}
						if (toolArgs.draft_id) {
							result = await updateEmailDraft({
								outboxId: String(toolArgs.draft_id),
								to: String(toolArgs.to ?? ""),
								cc: toolArgs.cc ? String(toolArgs.cc) : undefined,
								bcc: toolArgs.bcc ? String(toolArgs.bcc) : undefined,
								subject: String(toolArgs.subject ?? ""),
								body: draftBody,
							});
							break;
						}
						result = await createEmailDraft({
							to: String(toolArgs.to ?? ""),
							cc: toolArgs.cc ? String(toolArgs.cc) : undefined,
							bcc: toolArgs.bcc ? String(toolArgs.bcc) : undefined,
							subject: String(toolArgs.subject ?? ""),
							body: draftBody,
							chatUuid: String(toolArgs.chat_uuid ?? ""),
							threadId: toolArgs.thread_id ? String(toolArgs.thread_id) : undefined,
						});
						break;
					}
					// ── Short links ──
					case "create_short_link": {
						const target = String(toolArgs.target ?? "").trim();
						if (!TARGET_RE.test(target)) {
							result = { error: "target must be an http(s) URL" };
							break;
						}
						// optional attach: must be an existing post/newsletter doc
						const docIdRaw = String(toolArgs.doc_id ?? "").trim();
						let docId: string | null = null;
						if (docIdRaw) {
							if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(docIdRaw)) {
								result = { error: "doc_id must be a docs.id uuid — get one from list_docs" };
								break;
							}
							const [doc] = await db
								.select({ id: docs.id })
								.from(docs)
								.where(and(eq(docs.id, docIdRaw), inArray(docs.kind, ["post", "newsletter"])))
								.limit(1);
							if (!doc) {
								result = { error: "doc_id must be an existing post or newsletter (plain docs can't be attached)" };
								break;
							}
							docId = doc.id;
						}
						// slug is always a generated opaque key — retried on the astronomically rare PK collision
						for (let attempt = 0; attempt < 3; attempt++) {
							const slug = randomKey();
							try {
								await db.insert(shortLinks).values({ slug, target, docId });
								result = { slug, url: `${shortLinkBase()}/l/${slug}`, target, doc_id: docId, created: true };
								break;
							} catch (e) {
								if (!(e instanceof Error) || !e.message.includes("duplicate key")) throw e;
							}
						}
						result ??= { error: "could not generate a unique slug — call again" };
						break;
					}
					case "list_short_links":
						result = await db
							.select({
								slug: shortLinks.slug,
								target: shortLinks.target,
								clicks: shortLinks.clicks,
								doc_id: shortLinks.docId,
								doc_title: docs.title,
								doc_kind: docs.kind,
								created_at: shortLinks.createdAt,
							})
							.from(shortLinks)
							.leftJoin(docs, eq(shortLinks.docId, docs.id))
							.orderBy(desc(shortLinks.clicks), desc(shortLinks.createdAt));
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
		server: "madcactus-brain",
		version: "1.0.0",
		protocol: PROTOCOL_VERSION,
		endpoint: "POST /api/brain-mcp",
		auth: "Authorization: Bearer mc_<admin-api-key>",
		tools: TOOLS.map((t) => t.name),
	});
}
