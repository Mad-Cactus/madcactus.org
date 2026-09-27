import type { APIEvent } from "@solidjs/start/server";
import { logVideoOpen, logVideoWatch } from "~/lib/videos";
import { isBotUA } from "~/lib/bot-ua";

// Beacon receiver for watch pages (/v/:id + public/v-watch.js). The id is the
// VIDEOS row id (the watch page resolves legacy /v/<prospect-uuid> links to
// their video and beacons that instead).
// open  → first/last timestamps, unwatched → watching, prospect
//         proposed/sent → watching. NOT counted as a view: headless scanners
//         execute JS and fire open but never load the video (Flora Legal
//         Group showed "viewed 1x" with zero watch data).
// watch → real played seconds (native <video> events; client is untrusted)
//         plus max position reached, duration, completion.
//         `viewed Nx` increments on the first beacon with actual playback —
//         a click/scan that never plays shows "opened …" instead.
export async function POST(event: APIEvent) {
	if (isBotUA(event.request.headers.get("user-agent"))) return new Response(null, { status: 204 });
	let body: { id?: string; type?: string; seconds?: number; position?: number; duration?: number; completed?: boolean };
	try {
		body = await event.request.json();
	} catch {
		return new Response("Bad JSON", { status: 400 });
	}

	const id = body.id ?? "";
	const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
	if (!isUuid) return new Response("Bad id", { status: 400 });
	// fly logs: identify scanners firing beacons with UAs that dodge the denylist
	console.log(`[video-event] ${body.type} id=${id} ua=${event.request.headers.get("user-agent") ?? "(none)"}`);

	if (body.type === "open") {
		await logVideoOpen(id);
		return new Response(null, { status: 204 });
	}

	if (body.type === "watch") {
		// clamp every number — the client is untrusted
		await logVideoWatch(id, {
			seconds: Math.max(0, Math.min(Number(body.seconds) || 0, 7200)),
			position: Math.max(0, Math.min(Math.round(Number(body.position) || 0), 86400)),
			duration: Math.max(0, Math.min(Math.round(Number(body.duration) || 0), 86400)),
			completed: body.completed === true,
		});
		return new Response(null, { status: 204 });
	}

	return new Response("Unknown type", { status: 400 });
}
