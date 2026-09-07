// Outbox server core — schedule/send/draft persistence. Split out of
// email-queries.ts: standalone exported fns there kept the module isomorphic,
// so its `import { db }` chain (postgres → Buffer.allocUnsafe at module eval)
// landed in the client bundle → "Buffer is not defined" on the email page.
// Every consumer here is server-side (API routes, scheduler, brain MCP);
// "use server" stays on the previously-marked fns as a tripwire — a future
// client import gets RPC stubs instead of a db-in-browser crash.
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "~/db";
import { emailMessages, emailOutbox, emailThreads } from "~/db/schema";
import { getPrimaryAccount, threadWithMessages, sendGmail } from "~/lib/gmail";
import { trackText } from "~/lib/crdt-text-db";
import { lintVoiceText, recordLintOverrides } from "~/lib/voice-lint-db";
import type { LintViolation } from "~/lib/voice-lint";

export type SendResult =
	| { ok: true; gmailMessageId: string }
	| { ok: false; error: string }
	| { ok: false; blocked: "voice_lint"; violations: LintViolation[] };

/**
 * Schedule an outbox draft for later sending. Same voice-lint gate as Send —
 * scheduling is the human's final intent, so violations block here (with an
 * explicit override); the ticker then sends unguarded at fire time.
 */
export async function scheduleOutboxDraft(
	outboxId: string,
	when: Date,
	opts: { body?: string; overrideLint?: boolean } = {},
): Promise<{ ok: true; sendAt: string } | { ok: false; error: string } | { ok: false; blocked: "voice_lint"; violations: LintViolation[] }> {
	"use server";
	const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, outboxId));
	if (!row) return { ok: false, error: "draft not found" };
	if (row.status === "sent") return { ok: false, error: "already sent" };
	if (Number.isNaN(when.getTime())) return { ok: false, error: "invalid sendAt" };

	const body = opts.body ?? row.body;
	if (opts.body !== undefined) await saveDraftBody(outboxId, body);

	const lint = await lintVoiceText(body);
	if (lint.avoidCount > 0 && !opts.overrideLint) {
		return { ok: false, blocked: "voice_lint", violations: lint.violations };
	}
	if (lint.avoidCount > 0 && opts.overrideLint) {
		await recordLintOverrides(lint.violations.map((v) => v.patternId), outboxId);
	}

	await db
		.update(emailOutbox)
		.set({ sendAt: when, status: "draft", error: null, body })
		.where(eq(emailOutbox.id, outboxId));
	return { ok: true, sendAt: when.toISOString() };
}

export async function unscheduleOutboxDraft(outboxId: string): Promise<boolean> {
	"use server";
	const rows = await db
		.update(emailOutbox)
		.set({ sendAt: null })
		.where(eq(emailOutbox.id, outboxId))
		.returning({ id: emailOutbox.id });
	return rows.length > 0;
}

/**
 * Send an outbox draft: the body is LINTED against voice patterns first —
 * avoid-violations BLOCK the send (the gate). If the draft came from an agent
 * Agent drafts land here via createEmailDraft; the human edits (or not).
 */
export async function sendOutboxDraft(
	outboxId: string,
	bodyOverride?: string,
	opts: { overrideLint?: boolean } = {},
): Promise<SendResult | { ok: false; blocked: "voice_lint"; violations: Awaited<ReturnType<typeof lintVoiceText>>["violations"] }> {
	"use server";
	return sendOutboxInner(outboxId, bodyOverride, opts);
}

/** Plain (non-RPC) core — callable from the scheduler ticker, which has no
 *  request context, unlike "use server" wrappers. */
export async function sendOutboxInner(
	outboxId: string,
	bodyOverride?: string,
	opts: { overrideLint?: boolean } = {},
): Promise<SendResult | { ok: false; blocked: "voice_lint"; violations: Awaited<ReturnType<typeof lintVoiceText>>["violations"] }> {
	const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, outboxId));
	if (!row) return { ok: false, error: "draft not found" };
	if (row.status === "sent") return { ok: false, error: "already sent" };

	const body = bodyOverride ?? row.body;

	const account = await getPrimaryAccount();
	if (!account) return { ok: false, error: "NO_ACCOUNT: connect Gmail first" };

	// voice send gate: un-fixed avoid-violations block the send. The human can
	// override — that override is recorded as signal for adapting the rules.
	const lint = await lintVoiceText(body);
	if (lint.avoidCount > 0 && !opts.overrideLint) {
		return { ok: false, blocked: "voice_lint", violations: lint.violations };
	}
	if (lint.avoidCount > 0 && opts.overrideLint) {
		await recordLintOverrides(lint.violations.map((v) => v.patternId), outboxId);
	}

	// reply threading: find the last message in the thread
	let inReplyToGmailId: string | undefined;
	if (row.threadId) {
		const [thread] = await db.select().from(emailThreads).where(eq(emailThreads.id, row.threadId));
		if (thread) {
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
}): Promise<{ outboxId: string; lint: Awaited<ReturnType<typeof lintVoiceText>> }> {
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
	// v1 of the draft's tracked history = the agent's original body
	const tracked = await trackText("email_draft", outbox.id, "", "agent", input.body);
	if (tracked) {
		await db
			.update(emailOutbox)
			.set({ loroSnapshot: tracked.loroSnapshot, version: tracked.version })
			.where(eq(emailOutbox.id, outbox.id));
	}
	// advisory: the agent gets voice violations back and can revise + resubmit
	const lint = await lintVoiceText(input.body);
	return { outboxId: outbox.id, lint };
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
