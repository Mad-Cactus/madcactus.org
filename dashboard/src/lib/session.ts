import { getCookie, setCookie } from "@solidjs/start/http";
import { supabaseAdmin } from "./supabase";
import type { User } from "@supabase/supabase-js";

const COOKIE_OPTS = {
	httpOnly: true,
	secure: false, // local dev
	sameSite: "lax" as const,
	path: "/",
	maxAge: 60 * 60 * 24 * 7, // 7 days
};

/** Authenticated Supabase client, or null if not logged in. */
export async function getAuthedClient() {
	const accessToken = getCookie("mc-access-token");
	const refreshToken = getCookie("mc-refresh-token");
	if (!accessToken || !refreshToken) return null;

	let supabase;
	try {
		supabase = supabaseAdmin();
	} catch (e) {
		console.error("auth client init failed:", e);
		return null;
	}
	const { data, error } = await supabase.auth.setSession({
		access_token: accessToken,
		refresh_token: refreshToken,
	});
	if (error || !data.session) return null;

	// Refresh tokens rotated — update the cookie
	if (data.session.access_token !== accessToken) {
		setCookie("mc-access-token", data.session.access_token, COOKIE_OPTS);
		setCookie("mc-refresh-token", data.session.refresh_token, COOKIE_OPTS);
	}
	return supabase;
}

export async function getCurrentUser(): Promise<User | null> {
	const client = await getAuthedClient();
	if (!client) return null;
	const { data } = await client.auth.getUser();
	return data.user;
}

export async function signIn(email: string, password: string) {
	try {
		const supabase = supabaseAdmin();
		const { data, error } = await supabase.auth.signInWithPassword({
			email,
			password,
		});
		if (error || !data.session) {
			return { error: error?.message ?? "Login failed" };
		}
		setCookie("mc-access-token", data.session.access_token, COOKIE_OPTS);
		setCookie("mc-refresh-token", data.session.refresh_token, COOKIE_OPTS);
		// Signed owner cookie on the parent domain: every *.madcactus.org brain
		// verifies the HMAC and skips tracking for this browser — zero-step
		// self-exclusion (brains check it against their OWNER_SECRET). Admin
		// login only; the client portal uses clientLoginAction and must never
		// mark a prospect's browser as "self".
		const ownerSecret = process.env.OWNER_SECRET || "";
		if (ownerSecret) {
			const exp = Date.now() + 30 * 86_400_000;
			const sig = new Bun.CryptoHasher("sha256", ownerSecret).update(String(exp)).digest("hex");
			const ownerOpts: typeof COOKIE_OPTS & { domain?: string } = { ...COOKIE_OPTS, maxAge: 60 * 60 * 24 * 30 };
			if (process.env.NODE_ENV === "production") ownerOpts.domain = ".madcactus.org";
			setCookie("mc_owner", `${exp}.${sig}`, ownerOpts);
		}
		return { error: null };
	} catch (e) {
		// Log infra detail server-side; never surface it to the client.
		console.error("signIn failed:", e);
		const msg = e instanceof Error ? e.message : String(e);
		if (msg.includes("aborted") || msg.includes("timeout"))
			return { error: "Request timed out. Please try again." };
		return { error: "Something went wrong. Please try again." };
	}
}

export async function signOut() {
	setCookie("mc-access-token", "", { ...COOKIE_OPTS, maxAge: 0 });
	setCookie("mc-refresh-token", "", { ...COOKIE_OPTS, maxAge: 0 });
}
