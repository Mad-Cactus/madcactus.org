// Slack sync — raw mirror into slack_users/channels/messages (source-of-record,
// same contract as email). The brain distills it via extractSlackFacts.
//
// Token: SLACK_TOKEN (falls back to SLACK_BOT_TOKEN).
//   xoxp (user token)  → sees EVERYTHING you can see: all public channels,
//                        your private channels, your DMs. No /invite needed.
//                        USER scopes required: users:read, users:read.email,
//                        channels:read, channels:history, groups:read,
//                        groups:history, im:read, im:history, mpim:read,
//                        mpim:history
//   xoxb (bot token)   → public channels the bot is /invite-d to. Bot scopes:
//                        users:read, users:read.email, channels:read,
//                        channels:history
import { desc, eq } from "drizzle-orm";
import { db } from "~/db";
import { slackChannels, slackMessages, slackUsers } from "~/db/schema";

const API = "https://slack.com/api";

function slackToken(): string {
	return process.env.SLACK_TOKEN || process.env.SLACK_BOT_TOKEN || "";
}

async function slack<T>(method: string, body: Record<string, unknown>): Promise<T> {
	const token = slackToken();
	if (!token) throw new Error("SLACK_BOT_TOKEN not set");
	const res = await fetch(`${API}/${method}`, {
		method: "POST",
		headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`Slack ${method} ${res.status}`);
	const body2 = (await res.json()) as T & { ok: boolean; error?: string };
	if (!body2.ok) throw new Error(`Slack ${method}: ${body2.error}`);
	return body2;
}

/** Sync users, channels the bot is in, and ~30 days of their history. */
export async function syncSlack(opts: { days?: number; maxChannels?: number } = {}): Promise<Record<string, unknown>> {
	const token = slackToken();
	if (!token) return { skipped: "SLACK_TOKEN not set" };
	// xoxp = user token: everything the user can see, incl. private + DMs
	const isUser = token.startsWith("xoxp");
	const types = isUser ? "public_channel,private_channel,im,mpim" : "public_channel";
	const defaultMax = isUser ? 150 : 25;
	const days = opts.days ?? 30;
	const maxChannels = opts.maxChannels ?? defaultMax;
	const oldest = new Date(Date.now() - days * 86_400_000);
	let users = 0;
	let channels = 0;
	let messages = 0;

	// users
	let userCursor: string | undefined;
	do {
		const page = await slack<{ members: { id: string; name: string; real_name?: string; is_bot?: boolean; deleted?: boolean; profile?: { email?: string } }[]; response_metadata?: { next_cursor?: string } }>(
			"users.list",
			userCursor ? { cursor: userCursor, limit: 200 } : { limit: 200 },
		);
		for (const u of page.members) {
			await db
				.insert(slackUsers)
				.values({
					slackId: u.id,
					name: u.name,
					realName: u.real_name ?? "",
					email: u.profile?.email ?? null,
					isBot: !!u.is_bot,
					deleted: !!u.deleted,
				})
				.onConflictDoUpdate({
					target: slackUsers.slackId,
					set: { name: u.name, realName: u.real_name ?? "", email: u.profile?.email ?? null, isBot: !!u.is_bot, deleted: !!u.deleted, syncedAt: new Date() },
				});
			users++;
		}
		userCursor = page.response_metadata?.next_cursor || undefined;
	} while (userCursor);

	// user id → display name map (messages store resolved names, keeps the
	// brain prompts self-contained without joins)
	const userName = new Map<string, string>();
	for (const u of await db.select().from(slackUsers)) {
		userName.set(u.slackId, u.realName || u.name);
	}

	// channels the bot is in
	let channelCursor: string | undefined;
	const channelList: { id: string; name?: string; purpose?: { value?: string }; is_archived?: boolean; user?: string }[] = [];
	do {
		const page = await slack<{ channels: { id: string; name?: string; purpose?: { value?: string }; is_archived?: boolean; user?: string }[]; response_metadata?: { next_cursor?: string } }>(
			"conversations.list",
			{
				types,
				exclude_archived: true,
				limit: 200,
				...(channelCursor ? { cursor: channelCursor } : {}),
			},
		);
		channelList.push(...page.channels);
		channelCursor = page.response_metadata?.next_cursor || undefined;
	} while (channelCursor);

	for (const c of channelList.slice(0, maxChannels)) {
		// im/mpim channels come back nameless — label them from the member map
		const name =
			c.name ||
			(c.user && userName.get(c.user) ? `dm ${userName.get(c.user)}` : "group-dm");
		const purpose = c.purpose?.value ?? "";
		const [row] = await db
			.insert(slackChannels)
			.values({ slackId: c.id, name, purpose, isArchived: !!c.is_archived })
			.onConflictDoUpdate({
				target: slackChannels.slackId,
				set: { name, purpose, isArchived: !!c.is_archived },
			})
			.returning();
		channels++;

		let historyCursor: string | undefined;
		do {
			const page = await slack<{ messages: { ts: string; user?: string; text?: string; bot_id?: string; subtype?: string; thread_ts?: string }[]; has_more?: boolean; response_metadata?: { next_cursor?: string } }>(
				"conversations.history",
				{ channel: c.id, limit: 200, oldest: (oldest.getTime() / 1000).toFixed(6), ...(historyCursor ? { cursor: historyCursor } : {}) },
			);
			const fresh = page.messages.filter((m) => !m.bot_id && !m.subtype && m.user);
			if (fresh.length > 0) {
				await db
					.insert(slackMessages)
					.values(
						fresh.map((m) => ({
							channelId: row.id,
							ts: m.ts,
							threadTs: m.thread_ts && m.thread_ts !== m.ts ? m.thread_ts : null,
							userId: m.user ?? null,
							userName: userName.get(m.user ?? "") ?? "",
							text: m.text ?? "",
							isBot: !!m.bot_id,
							messageAt: new Date(Number(m.ts) * 1000),
						})),
					)
					.onConflictDoNothing({ target: [slackMessages.channelId, slackMessages.ts] });
				messages += fresh.length;
			}
			historyCursor = page.has_more ? page.response_metadata?.next_cursor : undefined;
		} while (historyCursor);

		await db.update(slackChannels).set({ lastSyncAt: new Date() }).where(eq(slackChannels.id, row.id));
	}

	return { users, channels, messages };
}

/** Newest slack message time — used to skip extraction when nothing new. */
export async function newestSlackMessageAt(): Promise<Date | null> {
	const [row] = await db
		.select({ at: slackMessages.messageAt })
		.from(slackMessages)
		.orderBy(desc(slackMessages.messageAt))
		.limit(1);
	return row?.at ?? null;
}
