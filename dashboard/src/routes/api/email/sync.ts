import { getAuthedClient } from "~/lib/session";
import { getPrimaryAccount, syncAccount } from "~/lib/gmail";

/** POST /api/email/sync — pull latest threads into the dashboard. */
export const POST = async () => {
	if (!(await getAuthedClient())) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
	}
	const account = await getPrimaryAccount();
	if (!account) {
		return new Response(JSON.stringify({ error: "NO_ACCOUNT: connect Gmail first" }), { status: 400 });
	}
	try {
		return new Response(JSON.stringify(await syncAccount(account)), {
			headers: { "Content-Type": "application/json" },
		});
	} catch (e) {
		return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}
};
