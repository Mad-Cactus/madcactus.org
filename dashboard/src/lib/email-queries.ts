import { query, action, redirect } from "@solidjs/router";
import { and, desc, eq } from "drizzle-orm";
import { db } from "~/db";
import { emailOutbox, emailThreads } from "~/db/schema";
import { getAuthedClient } from "~/lib/session";
import {
	getPrimaryAccount,
	listInbox,
	setThreadArchived,
	setThreadUnread,
	syncAccount,
	threadWithMessages,
	sendGmail,
} from "~/lib/gmail";
import { finalizeDraft, lintDraft, saveRevision, shouldBlock } from "~/lib/redline";

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

export const getInboxQuery = query(async (opts: { q?: string; archived?: boolean } = {}) => {
	"use server";
	await requireAdmin();
	const account = await getPrimaryAccount();
	if (!account) return { connected: false as const, threads: [], drafts: [] };
	// sync on read if stale >2min — no background worker needed at this volume
	const stale = !account.lastSyncAt || Date.now() - account.lastSyncAt.getTime() > 2 * 60_000;
	if (stale) await syncAccount(account).catch(() => {});
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
	| { ok: true; gmailMessageId: string; pairId?: string }
	| { ok: false; blocked: true; violations: Awaited<ReturnType<typeof lintDraft>> }
	| { ok: false; error: string };

/**
 * Send an outbox draft: the body is LINTED against voice patterns first —
 * avoid-violations BLOCK the send (the gate). If the draft came from an agent
 * (draftId set), sending finalizes the redline draft → pair → derivation.
 */
export async function sendOutboxDraft(outboxId: string, bodyOverride?: string): Promise<SendResult> {
	"use server"; // file also exports client-imported query()/action() stubs — keep db chain out of the client bundle
	const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, outboxId));
	if (!row) return { ok: false, error: "draft not found" };
	if (row.status === "sent") return { ok: false, error: "already sent" };

	const body = bodyOverride ?? row.body;
	const violations = await lintDraft(body);
	if (shouldBlock(violations)) return { ok: false, blocked: true, violations };

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
		let pairId: string | undefined;
		if (row.draftId) {
			// human's sent text = final; agent's original = draft → pair
			await saveRevision(row.draftId, body, "human");
			pairId = await finalizeDraft(row.draftId);
		}
		await db
			.update(emailOutbox)
			.set({ status: "sent", body, gmailMessageId, pairId: pairId ?? null })
			.where(eq(emailOutbox.id, outboxId));
		return { ok: true, gmailMessageId, pairId };
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
 * Agent ingest (MCP create_email_draft): lint the body first — avoid-violations
 * BLOCK (agent gets them back to fix). Otherwise store a redline draft
 * (surface=email) + outbox row; the human reviews/edits/sends in the UI.
 */
export async function createEmailDraft(input: {
	to: string;
	subject: string;
	body: string;
	chatUuid: string;
	threadId?: string;
	context?: string;
}): Promise<{ blocked: true; violations: Awaited<ReturnType<typeof lintDraft>> } | { blocked: false; outboxId: string; draftId: string }> {
	"use server";
	const violations = await lintDraft(input.body);
	if (shouldBlock(violations)) return { blocked: true, violations };

	const { createDraft } = await import("~/lib/redline");
	const draft = await createDraft({
		content: input.body,
		context: input.context ?? `email to ${input.to}: ${input.subject}`,
		tags: "email",
		chatUuid: input.chatUuid,
		surface: "email",
	});
	const [outbox] = await db
		.insert(emailOutbox)
		.values({
			draftId: draft.id,
			threadId: input.threadId ?? null,
			toEmail: input.to,
			subject: input.subject,
			body: input.body,
			chatUuid: input.chatUuid,
		})
		.returning();
	return { blocked: false, outboxId: outbox.id, draftId: draft.id };
}
