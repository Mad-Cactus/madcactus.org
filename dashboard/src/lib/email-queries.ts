import { query, action, redirect } from "@solidjs/router";
import { and, desc, eq } from "drizzle-orm";
import { db } from "~/db";
import { emailOutbox, emailThreads } from "~/db/schema";
import { getAuthedClient } from "~/lib/session";import {
	getPrimaryAccount,
	listInbox,
	setThreadArchived,
	setThreadUnread,
	syncAccount,
	threadWithMessages,
	sendGmail,
} from "~/lib/gmail";
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

/** Account ids with a sync currently running (see getInboxQuery). */
const syncingAccounts = new Set<string>();

export const getInboxQuery = query(async (opts: { q?: string; archived?: boolean } = {}) => {
	"use server";
	await requireAdmin();
	const account = await getPrimaryAccount();
	if (!account) return { connected: false as const, threads: [], drafts: [] };
	// sync on read if stale >2min — no background worker at this volume.
	// Fire-and-forget: awaiting it here blocks SSR for the whole first sync
	// (50 threads × round-trips) and renders a white page. The email route
	// polls revalidate() until the rows land. In-flight guard keeps repeated
	// reads from stacking concurrent syncs (lastSyncAt only updates at the end).
	const stale = !account.lastSyncAt || Date.now() - account.lastSyncAt.getTime() > 2 * 60_000;
	if (stale && !syncingAccounts.has(account.id)) {
		syncingAccounts.add(account.id);
		void syncAccount(account)
			.catch(() => {})
			.finally(() => syncingAccounts.delete(account.id));
	}
	const threads = await listInbox(account, { q: opts.q, includeArchived: opts.archived });
	const drafts = await db
		.select()
		.from(emailOutbox)
		.where(eq(emailOutbox.status, "draft"))
		.orderBy(desc(emailOutbox.createdAt));
	return { connected: true as const, threads, drafts };
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
	return syncAccount(account);
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

export type SendResult =
	| { ok: true; gmailMessageId: string }
	| { ok: false; error: string };

/**
 * Send an outbox draft. Agent drafts land here via createEmailDraft; the human
 * edits (or not) and sends.
 */
export async function sendOutboxDraft(outboxId: string, bodyOverride?: string): Promise<SendResult> {
	"use server"; // file also exports client-imported query()/action() stubs — keep db chain out of the client bundle
	const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, outboxId));
	if (!row) return { ok: false, error: "draft not found" };
	if (row.status === "sent") return { ok: false, error: "already sent" };

	const body = bodyOverride ?? row.body;

	const account = await getPrimaryAccount();
	if (!account) return { ok: false, error: "NO_ACCOUNT: connect Gmail first" };

	// reply threading: find the last message in the thread
	let inReplyToGmailId: string | undefined;
	if (row.threadId) {
		const [thread] = await db.select().from(emailThreads).where(eq(emailThreads.id, row.threadId));
		if (thread) {
			const { threadWithMessages } = await import("~/lib/gmail");
			const full = await threadWithMessages(account, thread.id);
			inReplyToGmailId = full?.messages.filter((m) => !m.isSent).at(-1)?.gmailId;
		}
	}

	try {
		const gmailMessageId = await sendGmail(account, {
			to: row.toEmail,
			subject: row.subject,
			body,
			inReplyToGmailId,
		});
		await db
			.update(emailOutbox)
			.set({ status: "sent", body, gmailMessageId })
			.where(eq(emailOutbox.id, outboxId));
		return { ok: true, gmailMessageId };
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		await db.update(emailOutbox).set({ status: "failed", error }).where(eq(emailOutbox.id, outboxId));
		return { ok: false, error };
	}
}

export const sendDraftAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	return sendOutboxDraft(String(formData.get("outboxId")), String(formData.get("body") ?? "") || undefined);
}, "sendDraft");

/**
 * Agent ingest (brain MCP create_email_draft): store an outbox row; the human
 * reviews/edits/sends in the UI.
 */
export async function createEmailDraft(input: {
	to: string;
	subject: string;
	body: string;
	chatUuid: string;
	threadId?: string;
	context?: string;
}): Promise<{ outboxId: string }> {
	"use server";
	const [outbox] = await db
		.insert(emailOutbox)
		.values({
			threadId: input.threadId ?? null,
			toEmail: input.to,
			subject: input.subject,
			body: input.body,
			chatUuid: input.chatUuid,
		})
		.returning();
	return { outboxId: outbox.id };
}
