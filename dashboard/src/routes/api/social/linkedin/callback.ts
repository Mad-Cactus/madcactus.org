import type { APIEvent } from "@solidjs/start/server";
import { getAuthedClient } from "~/lib/session";
import { exchangeCode } from "~/lib/social";

/** OAuth callback — exchanges the code, stores tokens, redirects to the docs
 *  list. State cookie must match what ?start=1 set (CSRF). */
export const GET = async (event: APIEvent) => {
	if ((await getAuthedClient()) === null) return new Response("Unauthorized", { status: 401 });
	const url = new URL(event.request.url);
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const cookieState = event.request.headers
		.get("cookie")
		?.split(/;\s*/)
		.find((c) => c.startsWith("li_oauth_state="))
		?.split("=")[1];

	const fail = (msg: string) =>
		new Response(null, { status: 302, headers: { Location: `/admin/docs?linkedin=error&reason=${encodeURIComponent(msg)}` } });

	if (!code || !state || !cookieState || state !== cookieState) return fail("state mismatch or missing code");
	if (url.searchParams.get("error")) return fail(url.searchParams.get("error_description") ?? "consent denied");

	try {
		await exchangeCode(code, `${url.origin}/api/social/linkedin/callback`);
	} catch (e) {
		return fail(e instanceof Error ? e.message : String(e));
	}
	return new Response(null, {
		status: 302,
		headers: {
			Location: "/admin/docs?linkedin=connected",
			"Set-Cookie": "li_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
		},
	});
};
