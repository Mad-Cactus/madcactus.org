import { clientSignOut } from "~/lib/client-session";

export async function POST() {
	await clientSignOut();
	return new Response(null, {
		status: 302,
		headers: { Location: "/portal/login" },
	});
}
