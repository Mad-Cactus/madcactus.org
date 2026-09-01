import type { APIEvent } from "@solidjs/start/server";
import { getCookie } from "@solidjs/start/http";
import { supabaseAdmin } from "~/lib/supabase";
import { computeWaveform } from "~/lib/waveform";

/** Waveform peaks for the meeting draft editor's scrub bar. Auth: admin
 *  session (same as /api/download). Logic lives in lib/waveform.ts — the
 *  editor page consumes it via getWaveformQuery, since a relative fetch()
 *  to this route throws ERR_INVALID_URL during SSR. */
export async function GET(event: APIEvent) {
	// admin check, mirroring download.ts
	const accessToken = getCookie("mc-access-token");
	const refreshToken = getCookie("mc-refresh-token");
	if (!accessToken || !refreshToken) {
		return new Response("Unauthorized", { status: 401 });
	}
	const admin = supabaseAdmin();
	const { data: session } = await admin.auth.setSession({
		access_token: accessToken,
		refresh_token: refreshToken,
	});
	if (!session.session) return new Response("Unauthorized", { status: 401 });

	const path = new URL(event.request.url).searchParams.get("path");
	if (!path) return new Response("Missing path", { status: 400 });

	const wave = await computeWaveform(path);
	if (!wave) return new Response("Audio not found", { status: 404 });
	return Response.json(wave, { headers: { "cache-control": "private, max-age=3600" } });
}
