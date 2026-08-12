import { getCookie, setCookie } from "@solidjs/start/http";
import { eq } from "drizzle-orm";
import { db } from "~/db";
import { clientMembers } from "~/db/schema";
import { verifyPassword } from "./crypto";

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
	const [row] = await db
		.select()
		.from(clientMembers)
		.where(eq(clientMembers.email, email.toLowerCase()))
		.limit(1);

	if (!row || !row.isActive) return { error: "Invalid credentials" };
	if (!verifyPassword(password, row.passwordHash))
		return { error: "Invalid credentials" };

	setCookie(COOKIE_NAME, row.id, COOKIE_OPTS);
	return { error: null };
}

export async function clientSignOut() {
	setCookie(COOKIE_NAME, "", { ...COOKIE_OPTS, maxAge: 0 });
}
