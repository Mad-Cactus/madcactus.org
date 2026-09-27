// Gmail-grounded campaign stats — the single computation behind the MCP
// campaign_stats tool, the admin campaigns panel, and the brain's campaign
// facts. Numbers come from outbox rows (status='sent', linked to their
// campaign company) + synced email_messages only. No stage flags.
//
// Reply = synced inbound message (is_sent=false) from the exact contact
// address, dated at/after that company's first linked send. Same-domain
// different-address is NOT counted (strict match by design).
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "~/db";
import { campaigns, campaignCompanies, emailMessages, emailOutbox } from "~/db/schema";

export type CompanySendStats = {
	id: string;
	companyName: string;
	contactEmail: string | null;
	sends: number;
	firstSentAt: string | null;
	lastSentAt: string | null;
	replied: boolean;
	replyCount: number;
	lastReplyAt: string | null;
	lastReplySnippet: string | null;
};

export type CampaignStats = {
	id: string;
	name: string;
	companies: CompanySendStats[];
	companiesTouched: number;
	emailsSent: number;
	companiesReplied: number;
	/** replied / touched, 0..1 (0 when nothing touched) */
	replyRate: number;
	/** reply count attributed to the touch (campaign_step) it answered */
	repliesByStep: Record<number, number>;
	bestTouch: number | null;
};

type SendRow = { step: number | null; sentAt: Date };
type ReplyRow = { date: Date; snippet: string };

export async function campaignStats(campaignId?: string): Promise<CampaignStats[]> {
	const camps = campaignId
		? await db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns).where(eq(campaigns.id, campaignId))
		: await db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns).orderBy(campaigns.createdAt);
	if (camps.length === 0) return [];

	const cos = await db
		.select({
			id: campaignCompanies.id,
			campaignId: campaignCompanies.campaignId,
			companyName: campaignCompanies.companyName,
			contactEmail: campaignCompanies.contactEmail,
		})
		.from(campaignCompanies)
		.where(inArray(campaignCompanies.campaignId, camps.map((c) => c.id)));
	if (cos.length === 0) return camps.map((c) => finishStats(c.id, c.name, [], new Map(), new Map()));

	// linked sends: sent outbox rows joined to their synced message for the
	// real send time (coalesce → outbox.updated_at if the message row hasn't
	// landed yet — same instant for outbox-sent mail)
	const sends = await db
		.select({
			campaignCompanyId: emailOutbox.campaignCompanyId,
			campaignStep: emailOutbox.campaignStep,
			sentAt: sql<string>`coalesce(${emailMessages.date}, ${emailOutbox.updatedAt})`,
		})
		.from(emailOutbox)
		.leftJoin(emailMessages, eq(emailMessages.gmailId, emailOutbox.gmailMessageId))
		.where(and(inArray(emailOutbox.campaignCompanyId, cos.map((c) => c.id)), eq(emailOutbox.status, "sent")));

	const sendsByCompany = new Map<string, SendRow[]>();
	for (const s of sends) {
		if (!s.campaignCompanyId) continue;
		const list = sendsByCompany.get(s.campaignCompanyId) ?? [];
		list.push({ step: s.campaignStep, sentAt: new Date(s.sentAt) });
		sendsByCompany.set(s.campaignCompanyId, list);
	}

	// inbound from any contact of these campaigns; per-company date filtering
	// happens below (>= that company's first linked send)
	const contacts = [...new Set(cos.map((c) => c.contactEmail?.toLowerCase()).filter((x): x is string => !!x))];
	const inbound =
		contacts.length > 0
			? await db
					.select({ fromEmail: emailMessages.fromEmail, date: emailMessages.date, bodyText: emailMessages.bodyText })
					.from(emailMessages)
					.where(and(eq(emailMessages.isSent, false), inArray(sql`lower(${emailMessages.fromEmail})`, contacts)))
			: [];
	const repliesByContact = new Map<string, ReplyRow[]>();
	for (const m of inbound) {
		if (!m.fromEmail) continue;
		const list = repliesByContact.get(m.fromEmail.toLowerCase()) ?? [];
		list.push({ date: new Date(m.date), snippet: m.bodyText.replace(/\s+/g, " ").trim().slice(0, 140) });
		repliesByContact.set(m.fromEmail.toLowerCase(), list);
	}

	return camps.map((camp) => {
		const mine = cos.filter((c) => c.campaignId === camp.id);
		const perCompany = new Map<string, { stats: CompanySendStats; replies: ReplyRow[] }>();
		const companies: CompanySendStats[] = mine.map((c) => {
			const mySends = (sendsByCompany.get(c.id) ?? []).sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
			const first = mySends[0]?.sentAt ?? null;
			const myReplies = c.contactEmail
				? (repliesByContact.get(c.contactEmail.toLowerCase()) ?? [])
						.filter((r) => first !== null && r.date.getTime() >= first.getTime())
						.sort((a, b) => a.date.getTime() - b.date.getTime())
				: [];
			const stats: CompanySendStats = {
				id: c.id,
				companyName: c.companyName,
				contactEmail: c.contactEmail,
				sends: mySends.length,
				firstSentAt: first?.toISOString() ?? null,
				lastSentAt: mySends.at(-1)?.sentAt.toISOString() ?? null,
				replied: myReplies.length > 0,
				replyCount: myReplies.length,
				lastReplyAt: myReplies.at(-1)?.date.toISOString() ?? null,
				lastReplySnippet: myReplies.at(-1)?.snippet ?? null,
			};
			perCompany.set(c.id, { stats, replies: myReplies });
			return stats;
		});
		return finishStats(camp.id, camp.name, companies, sendsByCompany, perCompany);
	});
}

function finishStats(
	id: string,
	name: string,
	companies: CompanySendStats[],
	sendsByCompany: Map<string, SendRow[]>,
	perCompany: Map<string, { stats: CompanySendStats; replies: ReplyRow[] }>,
): CampaignStats {
	const touched = companies.filter((c) => c.sends > 0);
	const replied = touched.filter((c) => c.replied);
	const emailsSent = companies.reduce((n, c) => n + c.sends, 0);

	// attribute each reply to the touch it answered: the latest linked send
	// at/before the reply date
	const repliesByStep: Record<number, number> = {};
	for (const [companyId, { replies }] of perCompany) {
		const mySends = sendsByCompany.get(companyId) ?? [];
		for (const r of replies) {
			let step: number | null = null;
			for (const s of mySends) {
				if (s.sentAt.getTime() <= r.date.getTime() && s.step != null) step = s.step;
			}
			if (step != null) repliesByStep[step] = (repliesByStep[step] ?? 0) + 1;
		}
	}
	const bestTouch =
		Object.entries(repliesByStep)
			.map(([step, n]) => ({ step: Number(step), n }))
			.sort((a, b) => b.n - a.n || a.step - b.step)[0]?.step ?? null;

	return {
		id,
		name,
		companies,
		companiesTouched: touched.length,
		emailsSent,
		companiesReplied: replied.length,
		replyRate: touched.length ? replied.length / touched.length : 0,
		repliesByStep,
		bestTouch,
	};
}
