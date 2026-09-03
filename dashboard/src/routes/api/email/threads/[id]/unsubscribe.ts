import type { APIEvent } from "@solidjs/start/server";
import { getAuthedClient } from "~/lib/session";
import { findUnsubscribe, getPrimaryAccount, performUnsubscribe, setThreadArchived } from "~/lib/gmail";

/**
 * GET  /api/email/threads/:id/unsubscribe → UnsubInfo | null (lookup only)
 * POST /api/email/threads/:id/unsubscribe → fire the unsubscribe + archive the thread
 */
async function guard(event: APIEvent) {
	if (!(await getAuthedClient())) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
	const account = await getPrimaryAccount();
	if (!account) return new Response(JSON.stringify({ error: "NO_ACCOUNT: connect Gmail first" }), { status: 400 });
	return account;
}

export const GET = async (event: APIEvent) => {
	const account = await guard(event);
	if (account instanceof Response) return account;
	const info = await findUnsubscribe(account, event.params.id);
	return new Response(JSON.stringify(info), { headers: { "Content-Type": "application/json" } });
};

export const POST = async (event: APIEvent) => {
	const account = await guard(event);
	if (account instanceof Response) return account;
	const info = await findUnsubscribe(account, event.params.id);
	if (!info) {
		return new Response(JSON.stringify({ error: "no unsubscribe info in this thread" }), { status: 404 });
	}
	try {
		const via = await performUnsubscribe(account, info);
		await setThreadArchived(account, event.params.id, true); // out of sight once it's done
		return new Response(JSON.stringify({ ok: true, via, target: info.target }), {
			headers: { "Content-Type": "application/json" },
		});
	} catch (e) {
		return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 502 });
	}
};
