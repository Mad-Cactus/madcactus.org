import { query, action, redirect } from "@solidjs/router";
import { and, desc, eq } from "drizzle-orm";
import { db } from "~/db";
import { emailMessages, emailOutbox, emailThreads } from "~/db/schema";
import { getAuthedClient } from "~/lib/session";import {
	getPrimaryAccount,
	listInbox,
	listSent,
	setThreadArchived,
	setThreadUnread,
	syncAccount,
	threadWithMessages,
	sendGmail,
} from "~/lib/gmail";
import { trackText } from "~/lib/crdt-text";

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

export const getInboxQuery = query(async (opts: { q?: string } = {}) => {
	"use server";
	await requireAdmin();
	const account = await getPrimaryAccount();
	if (!account) return { connected: false as const, threads: [], drafts: [], sent: [] };
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
	const threads = await listInbox(account, { q: opts.q });
	const drafts = await db
		.select()
		.from(emailOutbox)
		.where(eq(emailOutbox.status, "draft"))
		.orderBy(desc(emailOutbox.createdAt));
	const sent = await listSent(account);
	return { connected: true as const, threads, drafts, sent };
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
 * Send an outbox draft: the body is LINTED against voice patterns first —
 * avoid-violations BLOCK the send (the gate). If the draft came from an agent
 * Agent drafts land here via createEmailDraft; the human edits (or not).
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
		// the sent body lands as its own tracked version (human author)
		const tracked = await trackText("email_draft", row.id, row.loroSnapshot, "human", body);
		await db
			.update(emailOutbox)
			.set({
				status: "sent",
				body,
				gmailMessageId,
				...(tracked ? { loroSnapshot: tracked.loroSnapshot, version: tracked.version } : {}),
			})
			.where(eq(emailOutbox.id, outboxId));
		// record the sent message locally — replies keep their thread current
		// without waiting for a sync (new composes land via the SENT sync)
		if (row.threadId) {
			await db
				.insert(emailMessages)
				.values({
					threadId: row.threadId,
					gmailId: gmailMessageId,
					toEmails: row.toEmail,
					bodyText: body,
					date: new Date(),
					isSent: true,
				})
				.onConflictDoNothing({ target: emailMessages.gmailId });
			await db
				.update(emailThreads)
				.set({ lastMessageAt: new Date() })
				.where(eq(emailThreads.id, row.threadId));
		}
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
 * reviews/edits/sends in the UI. v1 of the draft's tracked history = the
 * agent's original body.
 */
export async function createEmailDraft(input: {
	to: string;
	subject: string;
	body: string;
	chatUuid: string;
	threadId?: string;
	context?: string;
}): Promise<{ outboxId: string }> {
	"use server"; // without this the db chain lands in the client bundle → "Buffer is not defined"
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
	// v1 of the draft's tracked history = the agent's original body
	const tracked = await trackText("email_draft", outbox.id, "", "agent", input.body);
	if (tracked) {
		await db
			.update(emailOutbox)
			.set({ loroSnapshot: tracked.loroSnapshot, version: tracked.version })
			.where(eq(emailOutbox.id, outbox.id));
	}
	return { outboxId: outbox.id };
}

/**
 * Persist a human edit to a draft body (Drafts tab autosave / PUT endpoint).
 * CRDT-tracked like docs: hunk-diffed into the Loro snapshot + version row.
 * Returns the new version number (unchanged if body identical).
 */
export async function saveDraftBody(
	outboxId: string,
	body: string,
	author: "human" | "agent" = "human",
): Promise<number | null> {
	"use server"; // same client-bundle leak as createEmailDraft
	const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, outboxId));
	if (!row) return null;
	const tracked = await trackText("email_draft", outboxId, row.loroSnapshot, author, body);
	if (!tracked) return row.version;
	await db
		.update(emailOutbox)
		.set({ body, loroSnapshot: tracked.loroSnapshot, version: tracked.version })
		.where(eq(emailOutbox.id, outboxId));
	return tracked.version;
}
