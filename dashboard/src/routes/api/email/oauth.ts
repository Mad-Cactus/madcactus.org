import type { APIEvent } from "@solidjs/start/server";
import { getAuthedClient } from "~/lib/session";
import { accessTokenForRefresh, exchangeCode, oauthUrl } from "~/lib/gmail";
import { db } from "~/db";
import { emailAccounts } from "~/db/schema";
import { eq } from "drizzle-orm";

/**
 * Gmail OAuth.
 * GET /api/email/oauth          → 302 to Google consent
 * GET /api/email/oauth?code=…   → callback: exchange, store account, redirect
 */

function redirectUri(event: APIEvent): string {
	const url = new URL(event.request.url);
	const proto = event.request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
	const host = event.request.headers.get("x-forwarded-host") ?? event.request.headers.get("host") ?? url.host;
	return `${proto}://${host}/api/email/oauth`;
}

function to(location: string): Response {
	return new Response(null, { status: 302, headers: { Location: location } });
}

export const GET = async (event: APIEvent) => {
	if (!(await getAuthedClient())) return to("/admin/login");
	const url = new URL(event.request.url);
	const callbackUri = redirectUri(event);

	const code = url.searchParams.get("code");
	if (!code) return to(oauthUrl(callbackUri));
	const error = url.searchParams.get("error");
	if (error) return to(`/admin/email?connect=failed:${encodeURIComponent(error)}`);

	try {
		const tokens = await exchangeCode(code, callbackUri);
		const token = await accessTokenForRefresh(tokens.refresh_token);
		const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok) throw new Error(`profile fetch failed: ${(await res.text()).slice(0, 200)}`);
		const profile = (await res.json()) as { emailAddress: string; historyId: string };

		const [existing] = await db
			.select()
			.from(emailAccounts)
			.where(eq(emailAccounts.email, profile.emailAddress));
		if (existing) {
			await db
				.update(emailAccounts)
				.set({ refreshToken: tokens.refresh_token, scopes: tokens.scope, syncHistoryId: profile.historyId })
				.where(eq(emailAccounts.id, existing.id));
		} else {
			await db.insert(emailAccounts).values({
				email: profile.emailAddress,
				refreshToken: tokens.refresh_token,
				scopes: tokens.scope,
				syncHistoryId: profile.historyId,
			});
		}
		return to("/admin/email?connected=1");
	} catch (e) {
		return new Response(`Gmail connect failed: ${e instanceof Error ? e.message : e}`, { status: 500 });
	}
};
