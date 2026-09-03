import type { APIEvent } from "@solidjs/start/server";
import { getAuthedClient } from "~/lib/session";
import { getPrimaryAccount, setThreadArchived, setThreadUnread, threadWithMessages } from "~/lib/gmail";

/**
 * GET /api/email/threads/:id → { thread, messages } for the reading pane.
 */
export const GET = async (event: APIEvent) => {
	if (!(await getAuthedClient())) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
	}
	const account = await getPrimaryAccount();
	if (!account) {
		return new Response(JSON.stringify({ error: "NO_ACCOUNT: connect Gmail first" }), { status: 400 });
	}
	const full = await threadWithMessages(account, event.params.id);
	if (!full) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
	return new Response(JSON.stringify(full), { headers: { "Content-Type": "application/json" } });
};

/**
 * POST /api/email/threads/:id  { op: "archive" | "unarchive" | "read" | "unread" }
 * Mirrors macro's e / shift+e / u / shift+u.
 */
export const POST = async (event: APIEvent) => {
	if (!(await getAuthedClient())) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
	}
	const account = await getPrimaryAccount();
	if (!account) {
		return new Response(JSON.stringify({ error: "NO_ACCOUNT: connect Gmail first" }), { status: 400 });
	}
	const body = (await event.request.json().catch(() => ({}))) as { op?: string };
	try {
		switch (body.op) {
			case "archive":
				await setThreadArchived(account, event.params.id, true);
				break;
			case "unarchive":
				await setThreadArchived(account, event.params.id, false);
				break;
			case "read":
				await setThreadUnread(account, event.params.id, false);
				break;
			case "unread":
				await setThreadUnread(account, event.params.id, true);
				break;
			default:
				return new Response(JSON.stringify({ error: "unknown op" }), { status: 400 });
		}
		return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
	} catch (e) {
		return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500 });
	}
};
