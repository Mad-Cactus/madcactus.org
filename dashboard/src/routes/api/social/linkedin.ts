import type { APIEvent } from "@solidjs/start/server";
import { getAuthedClient } from "~/lib/session";
import { authUrl, externalOrigin, linkedInStatus } from "~/lib/social";
import { randomHex } from "~/lib/crypto";

/**
 * LinkedIn connection API — admin-session guarded.
 * GET  /api/social/linkedin           → { configured, connected, memberUrn?, expiresAt? }
 * GET  /api/social/linkedin?start=1   → 302 to LinkedIn consent (state cookie)
 * POST /api/social/linkedin           → disconnect
 */
function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const GET = async (event: APIEvent) => {
	if ((await getAuthedClient()) === null) return json({ error: "Unauthorized" }, 401);
	const url = new URL(event.request.url);

	if (!url.searchParams.has("start")) return json(await linkedInStatus());

	if ((await linkedInStatus()).configured === false) return json({ error: "LINKEDIN_CLIENT_ID/SECRET not configured" }, 500);
	const state = randomHex(16);
	const callback = `${externalOrigin(event.request)}/api/social/linkedin/callback`;
	const headers = new Headers({
		Location: authUrl(callback, state),
		"Set-Cookie": `li_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
	});
	return new Response(null, { status: 302, headers });
};

export const POST = async (event: APIEvent) => {
	if ((await getAuthedClient()) === null) return json({ error: "Unauthorized" }, 401);
	const { disconnectLinkedIn } = await import("~/lib/social");
	await disconnectLinkedIn();
	return json({ ok: true, connected: false });
};
