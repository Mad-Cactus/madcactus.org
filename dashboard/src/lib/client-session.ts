import { getCookie, setCookie } from "@solidjs/start/http";
import { eq } from "drizzle-orm";
import { db } from "~/db";
import { clientMembers } from "~/db/schema";
import { supabaseAdmin } from "./supabase";

const COOKIE_NAME = "mc-client-session";
const COOKIE_OPTS = {
	httpOnly: true,
	secure: false,
	sameSite: "lax" as const,
	path: "/",
	maxAge: 60 * 60 * 24 * 7,
};

export type ClientMemberSession = {
	id: string;
	name: string;
	email: string;
};

/** Returns the authenticated member record, or null. */
export async function getClient(): Promise<ClientMemberSession | null> {
	const memberId = getCookie(COOKIE_NAME);
	if (!memberId) return null;

	const [member] = await db
		.select({
			id: clientMembers.id,
			name: clientMembers.name,
			email: clientMembers.email,
		})
		.from(clientMembers)
		.where(eq(clientMembers.id, memberId))
		.limit(1);

	return member ?? null;
}

export async function clientSignIn(email: string, password: string) {
	const emailLower = email.toLowerCase();
	// Supabase Auth is the password gate; this lookup authorizes that the Supabase
	// user maps to a real, active portal member before issuing a session.
	const [row] = await db
		.select({ id: clientMembers.id, isActive: clientMembers.isActive })
		.from(clientMembers)
		.where(eq(clientMembers.email, emailLower))
		.limit(1);

	if (!row || !row.isActive) return { error: "Invalid credentials" };

	try {
		const { error } = await supabaseAdmin().auth.signInWithPassword({
			email: emailLower,
			password,
		});
		if (error) {
			if (/not confirmed|verify your email|invite/i.test(error.message))
				return { error: "Check your invite email to set your password, then sign in." };
			return { error: "Invalid credentials" };
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		if (msg.includes("aborted") || msg.includes("timeout"))
			return { error: "Request timed out. Please try again." };
		return { error: "Something went wrong. Please try again." };
	}

	setCookie(COOKIE_NAME, row.id, COOKIE_OPTS);
	return { error: null };
}

/** Issues the portal session cookie (login + invite activation). */
export function setClientSessionCookie(memberId: string) {
	setCookie(COOKIE_NAME, memberId, COOKIE_OPTS);
}

export async function clientSignOut() {
	setCookie(COOKIE_NAME, "", { ...COOKIE_OPTS, maxAge: 0 });
}
