import { desc, eq, ilike, or } from "drizzle-orm";
import { db } from "~/db";
import { emailMessages, emailThreads } from "~/db/schema";

export interface ProspectEmailCard {
	subject: string;
	snippet: string | null;
	lastMessageAt: Date;
	// true = the last message involving this address came FROM the prospect
	replied: boolean;
}

/** Latest synced message involving the address — the "who has the ball" read. */
export async function latestThreadFor(email: string): Promise<ProspectEmailCard | null> {
	const [last] = await db
		.select({
			threadId: emailMessages.threadId,
			isSent: emailMessages.isSent,
			date: emailMessages.date,
		})
		.from(emailMessages)
		.where(
			or(
				eq(emailMessages.fromEmail, email),
				ilike(emailMessages.toEmails, `%${email}%`),
			),
		)
		.orderBy(desc(emailMessages.date))
		.limit(1);
	if (!last) return null;
	const [thread] = await db
		.select({ subject: emailThreads.subject, snippet: emailThreads.snippet })
		.from(emailThreads)
		.where(eq(emailThreads.id, last.threadId))
		.limit(1);
	if (!thread) return null;
	return {
		subject: thread.subject,
		snippet: thread.snippet,
		lastMessageAt: last.date,
		replied: !last.isSent,
	};
}

/** Distinct addresses @<prospect domain> that have emailed us — candidates
 *  for one-click "link this address" on the prospect. */
export async function contactSuggestionsFor(
	email: string,
): Promise<{ email: string; lastAt: Date }[]> {
	const at = email.lastIndexOf("@");
	if (at < 1) return [];
	const domain = email.slice(at + 1);
	const rows = await db
		.select({ e: emailMessages.fromEmail, d: emailMessages.date })
		.from(emailMessages)
		.where(ilike(emailMessages.fromEmail, `%@${domain}`))
		.orderBy(desc(emailMessages.date))
		.limit(200);
	const seen = new Map<string, Date>();
	for (const r of rows) {
		if (r.e && !seen.has(r.e.toLowerCase())) seen.set(r.e.toLowerCase(), r.d);
	}
	return [...seen.entries()].map(([e, lastAt]) => ({ email: e, lastAt }));
}
