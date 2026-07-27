import { signOut } from "~/lib/session";

export async function POST() {
	await signOut();
	return new Response(null, {
		status: 302,
		headers: { Location: "/admin/login" },
	});
}
