import { getCookie, setCookie } from "@solidjs/start/http";
import { supabaseService } from "./supabase";
import { verifyPassword } from "./crypto";
import type { Client } from "./supabase";

const COOKIE_NAME = "mc-client-session";
const COOKIE_OPTS = {
	httpOnly: true,
	secure: false,
	sameSite: "lax" as const,
	path: "/",
	maxAge: 60 * 60 * 24 * 7,
};

/** Returns the authenticated client record, or null. */
export async function getClient(): Promise<Client | null> {
	const clientId = getCookie(COOKIE_NAME);
	if (!clientId) return null;

	const supabase = supabaseService();
	const { data } = await supabase
		.from("clients")
		.select("*")
		.eq("id", clientId)
		.eq("is_active", true)
		.single();
	return (data as Client) ?? null;
}

/** Service-role client scoped to the logged-in client's project. */
export async function getClientClient() {
	const client = await getClient();
	if (!client) return null;
	const supabase = supabaseService();
	return { supabase, client };
}

export async function clientSignIn(email: string, password: string) {
	const supabase = supabaseService();
	const { data } = await supabase
		.from("clients")
		.select("*")
		.eq("email", email.toLowerCase())
		.eq("is_active", true)
		.single();
	if (!data) return { error: "Invalid credentials" };
	const client = data as Client;
	if (!verifyPassword(password, client.password_hash)) {
		return { error: "Invalid credentials" };
	}
	setCookie(COOKIE_NAME, client.id, COOKIE_OPTS);
	return { error: null };
}

export async function clientSignOut() {
	setCookie(COOKIE_NAME, "", { ...COOKIE_OPTS, maxAge: 0 });
}
