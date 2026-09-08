// LinkedIn member posting — OAuth (openid + w_member_social) and text posts.
// Tokens live in social_accounts (one "linkedin" row), refreshed on use.
import { eq } from "drizzle-orm";
import { db } from "~/db";
import { socialAccounts } from "~/db/schema";

const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
// ponytail: hardcoded — each LinkedIn-Version (YYYYMM) dies ~12 months after
// release (202506 went inactive 2026-06 → 426 NONEXISTENT_VERSION, echo shows
// internal YYYYMM01 id). Future versions 426 too (202609 inactive in 2026-09).
// Bump by one month when scheduled posts fail with NONEXISTENT_VERSION.
const API_VERSION = "202608";

type Tokens = {
	accessToken: string;
	refreshToken?: string;
	expiresAt?: Date;
	memberUrn?: string;
};

/** Public origin the browser sees. In prod Fly terminates TLS, so url.origin
 *  is http:// — LinkedIn rejects a redirect_uri that doesn't match the https
 *  one registered in the app console (OAuth broke exactly this way). */
export function externalOrigin(req: Request): string {
	const url = new URL(req.url);
	const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? url.protocol.replace(":", "");
	const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
	return `${proto}://${host}`;
}

export type LinkedInStatus = {
	configured: boolean;
	connected: boolean;
	memberUrn?: string;
	expiresAt?: string;
};

function creds() {
	const clientId = process.env.LINKEDIN_CLIENT_ID;
	const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
	if (!clientId || !clientSecret) return null;
	return { clientId, clientSecret };
}

async function getAccount() {
	const [row] = await db.select().from(socialAccounts).where(eq(socialAccounts.provider, "linkedin"));
	return row ?? null;
}

export async function linkedInStatus(): Promise<LinkedInStatus> {
	const configured = creds() !== null;
	const row = await getAccount();
	return {
		configured,
		connected: row !== null,
		memberUrn: row?.memberUrn ?? undefined,
		expiresAt: row?.expiresAt?.toISOString(),
	};
}

export function authUrl(redirectUri: string, state: string): string {
	if (!creds()) throw new Error("LINKEDIN_CLIENT_ID/SECRET not configured");
	const params = new URLSearchParams({
		response_type: "code",
		client_id: creds()!.clientId,
		redirect_uri: redirectUri,
		state,
		scope: "openid profile w_member_social",
	});
	return `${AUTH_URL}?${params}`;
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
	const { clientId, clientSecret } = creds()!;
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ grant_type: "", client_id: clientId, client_secret: clientSecret, ...body }),
	});
	if (!res.ok) throw new Error(`linkedin token error ${res.status}: ${await res.text()}`);
	const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
	return {
		accessToken: json.access_token,
		refreshToken: json.refresh_token,
		expiresAt: new Date(Date.now() + json.expires_in * 1000),
	};
}

export async function exchangeCode(code: string, redirectUri: string): Promise<Tokens> {
	const tokens = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
	// openid scope → userinfo.sub is the member id for the person URN
	const res = await fetch("https://api.linkedin.com/v2/userinfo", {
		headers: { Authorization: `Bearer ${tokens.accessToken}` },
	});
	if (!res.ok) throw new Error(`linkedin userinfo error ${res.status}`);
	const { sub } = (await res.json()) as { sub: string };
	const memberUrn = `urn:li:person:${sub}`;
	await saveTokens({ ...tokens, memberUrn });
	return { ...tokens, memberUrn };
}

async function saveTokens(tokens: Tokens) {
	const values = {
		provider: "linkedin",
		accessToken: tokens.accessToken,
		refreshToken: tokens.refreshToken,
		expiresAt: tokens.expiresAt,
		memberUrn: tokens.memberUrn,
	};
	await db
		.insert(socialAccounts)
		.values(values)
		.onConflictDoUpdate({ target: socialAccounts.provider, set: values });
}

/** Valid access token, refreshing when close to expiry. Throws if never connected. */
async function validAccessToken(): Promise<string> {
	const row = await getAccount();
	if (!row) throw new Error("LinkedIn not connected");
	if (row.expiresAt && row.expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
		if (!row.refreshToken) throw new Error("LinkedIn token expired and no refresh token stored — reconnect required");
		const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: row.refreshToken });
		await saveTokens({
			accessToken: tokens.accessToken,
			refreshToken: tokens.refreshToken ?? row.refreshToken,
			expiresAt: tokens.expiresAt,
			memberUrn: row.memberUrn ?? undefined,
		});
		return tokens.accessToken;
	}
	return row.accessToken;
}

export async function disconnectLinkedIn() {
	await db.delete(socialAccounts).where(eq(socialAccounts.provider, "linkedin"));
}

/** Publish a text post as the connected member. Returns the post URN. */
export async function postToLinkedIn(text: string): Promise<string> {
	const [accessToken, row] = await Promise.all([validAccessToken(), getAccount()]);
	if (!row?.memberUrn) throw new Error("LinkedIn connected but member URN missing — reconnect required");
	const res = await fetch("https://api.linkedin.com/rest/posts", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"LinkedIn-Version": API_VERSION,
			"Content-Type": "application/json",
			"X-Restli-Protocol-Version": "2.0.0",
		},
		body: JSON.stringify({
			author: row.memberUrn,
			commentary: text,
			visibility: "PUBLIC",
			distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
			lifecycleState: "PUBLISHED",
			isReshareDisabledByAuthor: false,
		}),
	});
	if (!res.ok) throw new Error(`linkedin post error ${res.status}: ${await res.text()}`);
	const postId = res.headers.get("x-restli-id") ?? res.headers.get("X-RestLi-Id") ?? "";
	return `urn:li:share:${postId}`;
}

/** Comment on one of our own posts (e.g. the scheduled first comment).
 *  socialActions is LinkedIn's comment surface for shares/posts. */
export async function commentOnLinkedIn(postUrn: string, text: string): Promise<void> {
	const [accessToken, row] = await Promise.all([validAccessToken(), getAccount()]);
	if (!row?.memberUrn) throw new Error("LinkedIn connected but member URN missing — reconnect required");
	const res = await fetch(`https://api.linkedin.com/rest/socialActions/${encodeURIComponent(postUrn)}/comments`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"LinkedIn-Version": API_VERSION,
			"Content-Type": "application/json",
			"X-Restli-Protocol-Version": "2.0.0",
		},
		body: JSON.stringify({ actor: row.memberUrn, object: postUrn, message: { text } }),
	});
	if (!res.ok) throw new Error(`linkedin comment error ${res.status}: ${await res.text()}`);
}
