// Gmail client — OAuth token flow, incremental sync (history API), full sync,
// body extraction, MIME sending. One account (Collin's), kept deliberately thin.
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "~/db";
import { fromBase64, toBase64Url } from "~/lib/crypto";
import { emailAccounts, emailMessages, emailThreads, type EmailAccount, type EmailThread } from "~/db/schema";

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

/** One authenticated Gmail call with per-user rate-limit backoff. Exported for tests. */
export async function gmail<T>(account: EmailAccount, path: string, init?: RequestInit): Promise<T> {
	const token = await accessToken(account);
	const once = () =>
		fetch(`${GMAIL_API}${path}`, {
			...init,
			headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
		});
	// Sync bursts ~200 thread GETs through an 8-wide pool and Google throttles
	// per-user: 429/5xx, and 403 carrying a quota/rate reason. Back off and
	// retry instead of failing the whole sync/op. A 403 without that reason
	// (scopes, permission) is permanent and fails fast; 5xx is only retried on
	// GET — a retried POST that half-landed could double-send.
	let res = await once();
	for (let attempt = 0; ; attempt++) {
		const text = await res.text();
		const quota403 = res.status === 403 && /quota|rate/i.test(text);
		const retryable =
			res.status === 429 ||
			quota403 ||
			(res.status >= 500 && (init?.method ?? "GET") === "GET");
		if (!retryable || attempt === 3) {
			if (!res.ok) throw new Error(`gmail ${path}: ${text.slice(0, 300)}`);
			return (text ? JSON.parse(text) : null) as T; // DELETE returns 204 empty
		}
		const secs = Number(res.headers.get("Retry-After")) || 2 ** attempt;
		await new Promise((r) => setTimeout(r, (0.5 + Math.random()) * secs * 1000));
		res = await once();
	}
}

// ── Payload parsing ────────────────────────────────────────────────

type GmailPayload = {
	headers: { name: string; value: string }[];
	body?: { data?: string; size?: number };
	parts?: GmailPayload[];
	mimeType?: string;
};

function b64url(data: string): string {
	return fromBase64(data);
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
	snippet?: string;
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

async function fetchFullThread(account: EmailAccount, id: string) {
	return gmail<{ id: string; messages: GmailMessage[]; historyId: string }>(account, `/threads/${id}?format=full`);
}

/** Upsert one full thread (+ its messages). `archived` defaults to "does any
 *  message still carry INBOX" — Gmail's own truth, used for threads fetched
 *  outside a sync (search hits); sync passes it explicitly from the id lists. */
async function upsertThread(
	account: EmailAccount,
	full: Awaited<ReturnType<typeof fetchFullThread>>,
	archived?: boolean,
) {
	const messages = full.messages ?? [];
	if (messages.length === 0) return null;
	if (isTrashed(full)) {
		await removeLocalGmailThread(account, full.id);
		return null;
	}
	const last = latestMessage(messages)!;
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
			snippet: last.snippet ?? "",
			fromName: from.name ?? from.email,
			fromEmail: from.email,
			unread,
			archived: archived ?? !messages.some((m) => m.labelIds?.includes("INBOX")),
			lastMessageAt: lastDate,
		})
		.onConflictDoUpdate({
			target: emailThreads.gmailThreadId,
			set: {
				subject,
				snippet: last.snippet ?? "",
				fromName: from.name ?? from.email,
				fromEmail: from.email,
				unread,
				archived: archived ?? !messages.some((m) => m.labelIds?.includes("INBOX")),
				lastMessageAt: lastDate,
			},
		})
		.returning();

	for (const msg of messages) await upsertMessage(account, threadRow.id, msg);
	return threadRow;
}

/** Run fn over items with a small concurrency pool — Gmail round-trips are
 *  I/O-bound, so 8 in flight cuts a 150-call sync from ~1min sequential to ~8s. */
async function pooled<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
	let i = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (i < items.length) await fn(items[i++]);
		}),
	);
}

/** Fetch full threads for gmail ids not yet local, capped per call so the
 *  first-ever sync backfills over several background syncs instead of one
 *  API-storming request. Returns how many were fetched. */
async function fetchMissingThreads(account: EmailAccount, ids: string[], max: number): Promise<number> {
	if (ids.length === 0) return 0;
	const known = await db
		.select({ gmailThreadId: emailThreads.gmailThreadId })
		.from(emailThreads)
		.where(inArray(emailThreads.gmailThreadId, ids));
	const knownSet = new Set(known.map((r) => r.gmailThreadId));
	const missing = ids.filter((id) => !knownSet.has(id)).slice(0, max);
	await pooled(missing, 8, async (id) => {
		await upsertThread(account, await fetchFullThread(account, id));
	});
	return missing.length;
}

/** List every thread id carrying a label (paginated). ponytail: capped at
 *  2000 — one user's mailbox; raise the cap if it ever fills up. */
async function listThreadIds(account: EmailAccount, label: "INBOX" | "SENT", cap = 2000): Promise<string[]> {
	const ids: string[] = [];
	let pageToken: string | undefined;
	do {
		const page = await gmail<{ threads?: { id: string }[]; nextPageToken?: string }>(
			account,
			`/threads?labelIds=${label}&maxResults=500${pageToken ? `&pageToken=${pageToken}` : ""}`,
		);
		for (const t of page.threads ?? []) ids.push(t.id);
		pageToken = page.nextPageToken;
	} while (pageToken && ids.length < cap);
	return ids;
}

/** Sync: mirror Gmail's INBOX + SENT id lists into the local corpus. Unknown
 *  threads get fetched (capped per run), the 50 most recent inbox threads are
 *  re-fetched for freshness (unread/snippet/replies), and `archived` is
 *  mirrored from INBOX membership in bulk for everything else. ponytail: full
 *  id-list diff each sync instead of the history API — once the corpus is
 *  local a sync costs a few cheap list calls; history.list can come later. */
export async function syncAccount(account: EmailAccount): Promise<{ synced: number; full: boolean }> {
	const [inboxIds, sentIds] = await Promise.all([listThreadIds(account, "INBOX"), listThreadIds(account, "SENT")]);
	const inboxSet = new Set(inboxIds);
	const allIds = [...new Set([...inboxIds, ...sentIds])];

	let synced = await fetchMissingThreads(account, allIds, 100);

	let freshInbox = 0;
	await pooled(inboxIds.slice(0, 50), 8, async (id) => {
		const row = await upsertThread(account, await fetchFullThread(account, id), false);
		if (row) freshInbox++;
	});
	synced += freshInbox;

	// Re-fetch the 50 most recent SENT threads too — fetchMissingThreads skips
	// known ids, so replies sent from the Gmail UI on threads we already have
	// locally never landed until this loop existed.
	const sentFresh = sentIds.filter((id) => !inboxSet.has(id)).slice(0, 50);
	let freshSent = 0;
	await pooled(sentFresh, 8, async (id) => {
		const row = await upsertThread(account, await fetchFullThread(account, id));
		if (row) freshSent++;
	});
	synced += freshSent;

	const setArchived = async (ids: string[], archived: boolean) => {
		for (let i = 0; i < ids.length; i += 500) {
			await db
				.update(emailThreads)
				.set({ archived })
				.where(and(eq(emailThreads.accountId, account.id), inArray(emailThreads.gmailThreadId, ids.slice(i, i + 500))));
		}
	};
	await setArchived(inboxIds, false);
	await setArchived(allIds.filter((id) => !inboxSet.has(id)), true);

	// mark fresh — otherwise every read re-syncs
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

// ── Unsubscribe (List-Unsubscribe / RFC 8058 one-click) ──────────

export type UnsubInfo = {	target: string; type: "http" | "mailto"; oneClick: boolean; subject?: string };

/** Look up the List-Unsubscribe header on the newest received message. */
export async function findUnsubscribe(account: EmailAccount, threadRowId: string): Promise<UnsubInfo | null> {
	const msgs = await db
		.select({ gmailId: emailMessages.gmailId, isSent: emailMessages.isSent })
		.from(emailMessages)
		.where(eq(emailMessages.threadId, threadRowId))
		.orderBy(desc(emailMessages.date));
	const last = msgs.find((m) => !m.isSent) ?? msgs[0];
	if (!last?.gmailId) return null;
	const meta = await gmail<{ payload?: { headers?: { name: string; value: string }[] } }>(
		account,
		`/messages/${last.gmailId}?format=metadata`,
	);
	const headers = meta.payload?.headers ?? [];
	const get = (n: string) => headers.find((h) => h.name.toLowerCase() === n)?.value;
	const list = get("list-unsubscribe");
	if (!list) return null;
	const entries = [...list.matchAll(/<([^>]+)>/g)].map((m) => m[1]);
	const http = entries.find((e) => e.startsWith("http"));
	if (http) {
		return { target: http, type: "http", oneClick: !!get("list-unsubscribe-post") };
	}
	const mailto = entries.find((e) => e.startsWith("mailto:"));
	if (mailto) {
		const u = new URL(mailto);
		return {	target: u.pathname, type: "mailto", oneClick: false, subject: u.searchParams.get("subject") ?? "unsubscribe" };
	}
	return null;
}

/** Fire the unsubscribe. HTTP = RFC 8058 one-click POST; mailto = send the email. */
export async function performUnsubscribe(account: EmailAccount, info: UnsubInfo): Promise<"one-click" | "email"> {
	if (info.type === "http") {
		const res = await fetch(info.target, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: info.oneClick ? "List-Unsubscribe=One-Click" : undefined,
		});
		if (!res.ok) throw new Error(`unsubscribe POST failed: ${res.status}`);
		return "one-click";
	}
	await sendGmail(account, { to: info.target, subject: info.subject ?? "unsubscribe", body: "unsubscribe" });
	return "email";
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
	const raw = toBase64Url(buildMime({ to: input.to, subject: input.subject, body: input.body }));
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

// shared tail of spam/trash: gone from the inbox → drop the local rows too
async function removeLocalThread(account: EmailAccount, threadRowId: string) {
	await db.delete(emailMessages).where(eq(emailMessages.threadId, threadRowId));
	await db.delete(emailThreads).where(and(eq(emailThreads.id, threadRowId), eq(emailThreads.accountId, account.id)));
}

// sync-side mirror: Gmail says the thread is trashed → drop local rows so a
// concurrent sync can't resurrect mail the user just deleted
async function removeLocalGmailThread(account: EmailAccount, gmailThreadId: string) {
	const [row] = await db
		.select({ id: emailThreads.id })
		.from(emailThreads)
		.where(and(eq(emailThreads.gmailThreadId, gmailThreadId), eq(emailThreads.accountId, account.id)));
	if (!row) return;
	await removeLocalThread(account, row.id);
}

/** Last message by date — Gmail's message array order is not guaranteed, and
 *  picking the wrong "last" put the user's own sent text in the list preview. */
export function latestMessage(messages: GmailMessage[]): GmailMessage | undefined {
	return messages.slice().sort((a, b) => Number(a.internalDate) - Number(b.internalDate)).at(-1);
}

/** Every message carries the TRASH label → the thread lives in Gmail's trash. */
export function isTrashed(full: { messages?: GmailMessage[] }): boolean {
	const ms = full.messages ?? [];
	return ms.length > 0 && ms.every((m) => m.labelIds?.includes("TRASH"));
}

/** Report spam: SPAM label on, INBOX off, local rows dropped. */
export async function setThreadSpam(account: EmailAccount, threadRowId: string) {
	const [thread] = await db
		.select()
		.from(emailThreads)
		.where(and(eq(emailThreads.id, threadRowId), eq(emailThreads.accountId, account.id)));
	if (!thread) throw new Error("thread not found");
	try {
		await gmail(account, `/threads/${thread.gmailThreadId}/modify`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] }),
		});
	} catch (e) {
		// already reported elsewhere → still drop the local rows
		if (!String(e).includes("404")) throw e;
	}
	await removeLocalThread(account, threadRowId);
}

/** Trash: POST /trash moves the thread to trash (recoverable in Gmail).
 *  Never use DELETE here — threads.delete is a permanent erase that only
 *  service accounts with domain-wide delegation may call; for OAuth users it
 *  403s, which is why delete silently did nothing. */
export async function trashThread(account: EmailAccount, threadRowId: string) {
	const [thread] = await db
		.select()
		.from(emailThreads)
		.where(and(eq(emailThreads.id, threadRowId), eq(emailThreads.accountId, account.id)));
	if (!thread) throw new Error("thread not found");
	try {
		await gmail(account, `/threads/${thread.gmailThreadId}/trash`, { method: "POST" });
	} catch (e) {
		// already trashed elsewhere → still drop the local rows
		if (!String(e).includes("404")) throw e;
	}
	await removeLocalThread(account, threadRowId);
}

/** Inbox list — everything Gmail still counts as INBOX (`archived` mirrors
 *  that after each sync). Search runs through Gmail's index, so it covers the
 *  whole mailbox (sent included); matches never synced are fetched full first
 *  so results always have bodies. */
export async function listInbox(account: EmailAccount, opts: { q?: string } = {}) {
	if (opts.q) {
		const results = await gmail<{ threads?: GmailThreadRef[] }>(
			account,
			`/threads?q=${encodeURIComponent(opts.q)}&maxResults=50`,
		);
		const ids = (results.threads ?? []).map((t) => t.id);
		if (ids.length === 0) return [];
		await fetchMissingThreads(account, ids, 25);
		return db
			.select()
			.from(emailThreads)
			.where(inArray(emailThreads.gmailThreadId, ids))
			.orderBy(desc(emailThreads.lastMessageAt));
	}
	return db
		.select()
		.from(emailThreads)
		.where(and(eq(emailThreads.accountId, account.id), eq(emailThreads.archived, false)))
		.orderBy(desc(emailThreads.lastMessageAt));
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

/** Sent view: every thread with at least one message I sent, newest send
 *  first, carrying the recipient of its latest sent message. */
export async function listSent(account: EmailAccount) {
	// only the two sent-message fields the dedupe needs — selecting bodyText
	// for every sent message made each inbox revalidate haul thousands of rows
	const rows = await db
		.select({ thread: emailThreads, msg: { toEmails: emailMessages.toEmails, date: emailMessages.date } })
		.from(emailThreads)
		.innerJoin(emailMessages, and(eq(emailMessages.threadId, emailThreads.id), eq(emailMessages.isSent, true)))
		.where(eq(emailThreads.accountId, account.id))
		.orderBy(desc(emailMessages.date));
	// rows are date-desc → first sight of a thread is its latest sent message
	const seen = new Set<string>();
	const out: { thread: EmailThread; to: string | null; sentAt: Date }[] = [];
	for (const r of rows) {
		if (seen.has(r.thread.id)) continue;
		seen.add(r.thread.id);
		out.push({ thread: r.thread, to: r.msg.toEmails, sentAt: r.msg.date });
	}
	return out;
}
