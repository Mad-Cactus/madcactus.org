import { query, action, redirect, revalidate } from "@solidjs/router";
import { and, asc, desc, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { db } from "~/db";
import { emailOutbox } from "~/db/schema";
import { getAuthedClient } from "~/lib/session";
import {
	getPrimaryAccount,
	listInbox,
	listSent,
	setThreadArchived,
	setThreadUnread,
	syncAccount,
	threadWithMessages,
} from "~/lib/gmail";
import { sendOutboxDraft } from "~/lib/email-outbox";


async function requireAdmin() {
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");
}

async function requireAccount() {
	const account = await getPrimaryAccount();
	if (!account) throw new Error("NO_ACCOUNT: connect Gmail first (Email → Connect)");
	return account;
}

export const getEmailStatusQuery = query(async () => {
	"use server";
	await requireAdmin();
	const account = await getPrimaryAccount();
	return account ? { email: account.email, lastSyncAt: account.lastSyncAt } : null;
}, "email-status");

/** Account ids with a sync currently running (see triggerSyncIfStale). */
const syncingAccounts = new Set<string>();

/** Kick a Gmail sync if the account is stale (>10min) — fire-and-forget.
 *  No background worker at this volume: the Fly machine that runs this also
 *  auto-stops when idle, so a cron-style syncer would be dead anyway. Instead
 *  every page that consumes synced mail (email tab, outreach board) pokes
 *  this on load; the in-flight guard keeps repeated reads from stacking
 *  concurrent syncs (lastSyncAt only updates at the end). Fresh rows land on
 *  the NEXT load — callers render from what's already in the DB. */
export async function triggerSyncIfStale(): Promise<void> {
	// "use server" keeps this server-only: without it the directive-less export
	// travels into the client graph when admin-queries imports it, dragging
	// the db chain into the bundle (check-client-bundle trips).
	"use server";
	const account = await getPrimaryAccount();
	if (!account) return;
	const stale = !account.lastSyncAt || Date.now() - account.lastSyncAt.getTime() > 10 * 60_000;
	if (stale && !syncingAccounts.has(account.id)) {
		syncingAccounts.add(account.id);
		void syncAccount(account)
			.catch(() => {})
			.finally(() => syncingAccounts.delete(account.id));
	}
}

export const getInboxQuery = query(async (opts: { q?: string } = {}) => {
	"use server";
	await requireAdmin();
	const account = await getPrimaryAccount();
	if (!account) return { connected: false as const, threads: [], drafts: [], sent: [], outbox: [] };
	await triggerSyncIfStale();
	// Gmail's search index covers the whole mailbox — non-archived matches stay
	// in `threads` (Inbox tab), sent matches ride along in `sent` (Sent tab).
	const matches = await listInbox(account, { q: opts.q });
	const threads = opts.q ? matches.filter((t) => !t.archived) : matches;
	// sendAt must be null: a scheduled draft lives in the Outbox only — one
	// place at a time
	const drafts = await db
		.select()
		.from(emailOutbox)
		.where(and(eq(emailOutbox.status, "draft"), isNull(emailOutbox.sendAt)))
		.orderBy(desc(emailOutbox.createdAt));
	// Outbox — the scheduled-send queue (status≠sent; sent mail lives in the
	// Sent tab via Gmail sync). Failed scheduled sends stay visible here.
	const outbox = await db
		.select()
		.from(emailOutbox)
		.where(and(isNotNull(emailOutbox.sendAt), ne(emailOutbox.status, "sent")))
		.orderBy(asc(emailOutbox.sendAt));
	let sent = await listSent(account);
	if (opts.q) {
		const hits = new Set(matches.map((t) => t.id));
		sent = sent.filter((s) => hits.has(s.thread.id));
	}
	return { connected: true as const, threads, drafts, sent, outbox };
}, "email-inbox");

export const getThreadQuery = query(async (id: string) => {
	"use server";
	await requireAdmin();
	const account = await requireAccount();
	return threadWithMessages(account, id);
}, "email-thread");

export const getOutboxQuery = query(async () => {
	"use server";
	await requireAdmin();
	return db.select().from(emailOutbox).orderBy(desc(emailOutbox.updatedAt)).limit(50);
}, "email-outbox");

export const syncEmailAction = action(async () => {
	"use server";
	await requireAdmin();
	const account = await requireAccount();
	const out = await syncAccount(account);
	// the header reads email-status — without this the button synced but the
	// "last sync" timestamp stayed stale until a full reload
	await revalidate(getEmailStatusQuery.key);
	return out;
}, "syncEmail");

export const archiveEmailAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const account = await requireAccount();
	await setThreadArchived(account, String(formData.get("threadId")), formData.get("archived") !== "true");
	return { ok: true };
}, "archiveEmail");

export const unreadEmailAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const account = await requireAccount();
	await setThreadUnread(account, String(formData.get("threadId")), formData.get("unread") === "true");
	return { ok: true };
}, "unreadEmail");

export const sendDraftAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	return sendOutboxDraft(String(formData.get("outboxId")), String(formData.get("body") ?? "") || undefined);
}, "sendDraft");
