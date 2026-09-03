// Gmail client — OAuth token flow, incremental sync (history API), full sync,
// body extraction, MIME sending. One account (Collin's), kept deliberately thin.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "~/db";
import { emailAccounts, emailMessages, emailThreads, type EmailAccount } from "~/db/schema";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export const GMAIL_SCOPES = [
	"https://www.googleapis.com/auth/gmail.readonly",
	"https://www.googleapis.com/auth/gmail.send",
	"https://www.googleapis.com/auth/gmail.modify", // archive/unread changes
];

// fly secrets / .env values sometimes carry trailing whitespace → Google's
// cryptic "invalid_client"; trim defensively.
const clientId = () => (process.env.GMAIL_CLIENT_ID ?? "").trim();
const clientSecret = () => (process.env.GMAIL_CLIENT_SECRET ?? "").trim();

export function oauthUrl(redirectUri: string, state = ""): string {
	const id = clientId();
	if (!id) throw new Error("GMAIL_CLIENT_ID not set — see dashboard/.env.example");
	const params = new URLSearchParams({
		client_id: id,
		redirect_uri: redirectUri,
		response_type: "code",
		scope: GMAIL_SCOPES.join(" "),
		access_type: "offline", // refresh token
		prompt: "consent",
		include_granted_scopes: "true",
		...(state ? { state } : {}),
	});
	return `${GOOGLE_AUTH}?${params}`;
}

export async function exchangeCode(code: string, redirectUri: string) {
	const res = await fetch(GOOGLE_TOKEN, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			code,
			client_id: clientId(),
			client_secret: clientSecret(),
			redirect_uri: redirectUri,
			grant_type: "authorization_code",
		}),
	});
	if (!res.ok) throw new Error(`token exchange failed: ${await res.text()}`);
	return (await res.json()) as { refresh_token: string; scope: string };
}

// ── Authenticated calls ────────────────────────────────────────────

let tokenCache: { token: string; exp: number } | null = null;

async function accessToken(account: Pick<EmailAccount, "id" | "refreshToken">): Promise<string> {
	if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
	const token = await accessTokenForRefresh(account.refreshToken);
	tokenCache = { token, exp: Date.now() + 55 * 60_000 };
	setTimeout(() => (tokenCache = null), 55 * 60_000);
	return token;
}

export async function accessTokenForRefresh(refreshToken: string): Promise<string> {
	const res = await fetch(GOOGLE_TOKEN, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			refresh_token: refreshToken,
			client_id: clientId(),
			client_secret: clientSecret(),
			grant_type: "refresh_token",
		}),
	});
	if (!res.ok) throw new Error(`token refresh failed: ${(await res.text()).slice(0, 200)}`);
	const body = (await res.json()) as { access_token: string; expires_in: number };
	return body.access_token;
}

async function gmail<T>(account: EmailAccount, path: string, init?: RequestInit): Promise<T> {
	const token = await accessToken(account);
	const res = await fetch(`${GMAIL_API}${path}`, {
		...init,
		headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
	});
	if (!res.ok) throw new Error(`gmail ${path}: ${(await res.text()).slice(0, 300)}`);
	return (await res.json()) as T;
}

// ── Payload parsing ────────────────────────────────────────────────

type GmailPayload = {
	headers: { name: string; value: string }[];
	body?: { data?: string; size?: number };
	parts?: GmailPayload[];
	mimeType?: string;
};

function b64url(data: string): string {
	return Buffer.from(data, "base64url").toString("utf8");
}

function header(payload: GmailPayload, name: string): string {
	const h = payload.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
	return h?.value ?? "";
}

export function addr(value: string): { name: string | null; email: string } {
	const m = value.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
	if (m) return { name: m[1].trim() || null, email: m[2].trim() };
	return { name: null, email: value.trim() };
}

/** Extract plain text: prefer text/plain part, else strip tags from text/html. */
export function extractText(payload: GmailPayload): string {
	const walk = (p: GmailPayload): string | null => {
		if (p.mimeType === "text/plain" && p.body?.data) return b64url(p.body.data);
		for (const part of p.parts ?? []) {
			const found = walk(part);
			if (found) return found;
		}
		return null;
	};
	const plain = walk(payload);
	if (plain) return plain;
	const html = (p: GmailPayload): string | null => {
		if (p.mimeType === "text/html" && p.body?.data) return b64url(p.body.data);
		for (const part of p.parts ?? []) {
			const found = html(part);
			if (found) return found;
		}
		return null;
	};
	const raw = html(payload);
	// ponytail: regex de-tagging — good enough for reading pane + diffing.
	// Upgrade to a proper DOM parser if html emails render badly.
	return raw?.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n{3,}/g, "\n\n").trim() ?? "";
}

// ── Sync ───────────────────────────────────────────────────────────

type GmailThreadRef = {
	id: string;
	snippet: string;
	historyId: string;
};

type GmailMessage = {
	id: string;
	threadId: string;
	labelIds: string[];
	internalDate: string;
	payload: GmailPayload;
};

async function upsertMessage(account: EmailAccount, threadRowId: string, msg: GmailMessage) {
	const from = addr(header(msg.payload, "From"));
	await db
		.insert(emailMessages)
		.values({
			threadId: threadRowId,
			gmailId: msg.id,
			fromName: from.name,
			fromEmail: from.email,
			toEmails: header(msg.payload, "To"),
			bodyText: extractText(msg.payload),
			date: new Date(Number(msg.internalDate)),
			isSent: msg.labelIds?.includes("SENT") ?? false,
		})
		.onConflictDoNothing({ target: emailMessages.gmailId });
}

/** Sync an account: pulls the latest 50 threads (full snapshot each time).
 *  historyId is stored for a future incremental history.list upgrade —
 *  ponytail: 50 threads × round-trip is fine at one-user volume. */
export async function syncAccount(account: EmailAccount): Promise<{ synced: number; full: boolean }> {
	const list = await gmail<{ threads: GmailThreadRef[]; historyId?: string }>(
		account,
		"/threads?maxResults=50",
	);
	let synced = 0;
	for (const ref of list.threads ?? []) {
		const full = await gmail<{ id: string; messages: GmailMessage[]; historyId: string }>(
			account,
			`/threads/${ref.id}?format=full`,
		);
		const messages = full.messages ?? [];
		if (messages.length === 0) continue;
		const last = messages[messages.length - 1];
		const from = addr(header(last.payload, "From"));
		const subject = header(last.payload, "Subject") || "(no subject)";
		const unread = last.labelIds?.includes("UNREAD") ?? false;
		const lastDate = new Date(Number(last.internalDate));

		const [threadRow] = await db
			.insert(emailThreads)
			.values({
				accountId: account.id,
				gmailThreadId: full.id,
				subject,
				snippet: ref.snippet ?? "",
				fromName: from.name ?? from.email,
				fromEmail: from.email,
				unread,
				lastMessageAt: lastDate,
			})
			.onConflictDoUpdate({
				target: emailThreads.gmailThreadId,
				set: {
					subject,
					snippet: ref.snippet ?? "",
					fromName: from.name ?? from.email,
					fromEmail: from.email,
					unread,
					lastMessageAt: lastDate,
				},
			})
			.returning();

		for (const msg of messages) {
			await upsertMessage(account, threadRow.id, msg);
			synced++;
		}
	}
	if (list.historyId) {
		await db
			.update(emailAccounts)
			.set({ syncHistoryId: list.historyId });
	}
	// mark fresh even without a historyId — otherwise every read re-syncs
	await db
		.update(emailAccounts)
		.set({ lastSyncAt: new Date() })
		.where(eq(emailAccounts.id, account.id));
	return { synced, full: !account.syncHistoryId };
}

export async function getPrimaryAccount(): Promise<EmailAccount | null> {
	const [row] = await db.select().from(emailAccounts).limit(1);
	return row ?? null;
}

// ── Send ───────────────────────────────────────────────────────────

export function buildMime(input: { to: string; subject: string; body: string }): string {
	const headers = [
		`To: ${input.to}`,
		`Subject: ${input.subject}`,
		"MIME-Version: 1.0",
		'Content-Type: text/plain; charset="UTF-8"',
		"Content-Transfer-Encoding: 8bit",
	];
	return `${headers.join("\r\n")}\r\n\r\n${input.body}`;
}

/** Send via Gmail. Returns the new gmail message id. */
export async function sendGmail(
	account: EmailAccount,
	input: { to: string; subject: string; body: string; inReplyToGmailId?: string },
): Promise<string> {
	// Gmail threads replies via the threadId param — no In-Reply-To guessing
	const threadId = input.inReplyToGmailId ? await threadIdOf(account, input.inReplyToGmailId) : undefined;
	const raw = Buffer.from(buildMime({ to: input.to, subject: input.subject, body: input.body }))
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
	const res = await gmail<{ id: string }>(account, "/messages/send", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }),
	});
	return res.id;
}

async function threadIdOf(account: EmailAccount, gmailMessageId: string): Promise<string | undefined> {
	const [row] = await db
		.select({ gmailThreadId: emailThreads.gmailThreadId })
		.from(emailMessages)
		.innerJoin(emailThreads, eq(emailMessages.threadId, emailThreads.id))
		.where(eq(emailMessages.gmailId, gmailMessageId));
	return row?.gmailThreadId;
}

// ── Thread actions (macro's e/u keys) ──────────────────────────────

export async function setThreadArchived(account: EmailAccount, threadRowId: string, archived: boolean) {
	const [thread] = await db
		.select()
		.from(emailThreads)
		.where(and(eq(emailThreads.id, threadRowId), eq(emailThreads.accountId, account.id)));
	if (!thread) throw new Error("thread not found");
	// archive = remove INBOX label; unarchive = add it back
	const op = archived ? "remove" : "add";
	await gmail(account, `/threads/${thread.gmailThreadId}/modify`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ [`${op}LabelIds`]: ["INBOX"] }),
	});
	await db.update(emailThreads).set({ archived }).where(eq(emailThreads.id, threadRowId));
}

export async function setThreadUnread(account: EmailAccount, threadRowId: string, unread: boolean) {
	const [thread] = await db
		.select()
		.from(emailThreads)
		.where(and(eq(emailThreads.id, threadRowId), eq(emailThreads.accountId, account.id)));
	if (!thread) throw new Error("thread not found");
	await gmail(account, `/threads/${thread.gmailThreadId}/modify`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(unread ? { addLabelIds: ["UNREAD"] } : { removeLabelIds: ["UNREAD"] }),
	});
	await db.update(emailThreads).set({ unread }).where(eq(emailThreads.id, threadRowId));
}

/** Inbox list (or search via Gmail q passthrough). */
export async function listInbox(account: EmailAccount, opts: { q?: string; includeArchived?: boolean } = {}) {
	if (opts.q) {
		// search live via Gmail, then reconcile rows (best of both: fast, fresh)
		const results = await gmail<{ threads: GmailThreadRef[] }>(
			account,
			`/threads?q=${encodeURIComponent(opts.q)}&maxResults=25`,
		);
		const ids = (results.threads ?? []).map((t) => t.id);
		if (ids.length === 0) return [];
		const rows = await db
			.select()
			.from(emailThreads)
			.where(inArray(emailThreads.gmailThreadId, ids))
			.orderBy(desc(emailThreads.lastMessageAt));
		// fire-and-forget sync of searched threads so bodies exist
		void syncAccount(account).catch(() => {});
		return rows;
	}
	const where = opts.includeArchived
		? eq(emailThreads.accountId, account.id)
		: and(eq(emailThreads.accountId, account.id), eq(emailThreads.archived, false));
	return db
		.select()
		.from(emailThreads)
		.where(where)
		.orderBy(desc(emailThreads.lastMessageAt))
		.limit(50);
}

export async function threadWithMessages(account: EmailAccount, threadRowId: string) {
	const [thread] = await db
		.select()
		.from(emailThreads)
		.where(and(eq(emailThreads.id, threadRowId), eq(emailThreads.accountId, account.id)));
	if (!thread) return null;
	const messages = await db
		.select()
		.from(emailMessages)
		.where(eq(emailMessages.threadId, threadRowId))
		.orderBy(emailMessages.date);
	return { thread, messages };
}

/** Count helpers for the UI header. */
export async function inboxCounts(account: EmailAccount) {
	const [{ unread }] = await db
		.select({ unread: sql<number>`count(*)::int` })
		.from(emailThreads)
		.where(and(eq(emailThreads.accountId, account.id), eq(emailThreads.unread, true), eq(emailThreads.archived, false)));
	const [{ total }] = await db
		.select({ total: sql<number>`count(*)::int` })
		.from(emailThreads)
		.where(and(eq(emailThreads.accountId, account.id), eq(emailThreads.archived, false)));
	return { unread, total };
}
