import type { APIEvent } from "@solidjs/start/server";
import { getCookie } from "@solidjs/start/http";
import { supabaseAdmin, supabaseService } from "~/lib/supabase";

/** Generate a signed download URL for a file in portal-docs storage.
 *  Auth: admin (mc-access-token) or client (mc-client-session). */
export async function GET(event: APIEvent) {
	const path = new URL(event.request.url).searchParams.get("path");
	if (!path) return new Response("Missing path", { status: 400 });

	// Check admin auth
	const accessToken = getCookie("mc-access-token");
	const refreshToken = getCookie("mc-refresh-token");
	if (accessToken && refreshToken) {
		const admin = supabaseAdmin();
		const { data: session } = await admin.auth.setSession({
			access_token: accessToken,
			refresh_token: refreshToken,
		});
		if (session.session) {
			return redirectToSignedUrl(path);
		}
	}

	// Check client auth
	const clientId = getCookie("mc-client-session");
	if (clientId) {
		const svc = supabaseService();
		const { data: client } = await svc
			.from("clients")
			.select("project_id")
			.eq("id", clientId)
			.eq("is_active", true)
			.single();
		// Verify the file path starts with the client's project_id
		if (client && path.startsWith(`${client.project_id}/`)) {
			return redirectToSignedUrl(path);
		}
	}

	return new Response("Unauthorized", { status: 401 });
}

async function redirectToSignedUrl(path: string) {
	const svc = supabaseService();
	const { data, error } = await svc.storage
		.from("portal-docs")
		.createSignedUrl(path, 3600); // 1 hour
	if (error || !data?.signedUrl) {
		return new Response("File not found", { status: 404 });
	}
	return new Response(null, {
		status: 302,
		headers: { Location: data.signedUrl },
	});
}
