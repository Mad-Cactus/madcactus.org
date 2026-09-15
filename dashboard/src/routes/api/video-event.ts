import type { APIEvent } from "@solidjs/start/server";
import { eq, sql } from "drizzle-orm";
import { db } from "~/db";
import { outreachProspects } from "~/db/schema";
import { isBotUA } from "~/lib/bot-ua";

// Beacon receiver for watch pages (/v/:id + public/v-watch.js).
// open  → first/last timestamps, proposed/sent → watching. NOT counted as a
//         view: headless scanners execute JS and fire open but never load the
//         video (Flora Legal Group showed "viewed 1x" with zero watch data).
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
		await db
			.update(outreachProspects)
			.set({
				videoFirstViewedAt: sql`coalesce(${outreachProspects.videoFirstViewedAt}, now())`,
				videoLastViewedAt: sql`now()`,
				// stage literals from OUTREACH_STAGES — static, safe to inline
				stage: sql`case when ${outreachProspects.stage} in ('proposed', 'sent') then 'watching' else ${outreachProspects.stage} end`,
			})
			.where(eq(outreachProspects.id, id));
		return new Response(null, { status: 204 });
	}

	if (body.type === "watch") {
		// clamp every number — the client is untrusted
		const seconds = Math.max(0, Math.min(Number(body.seconds) || 0, 7200));
		const position = Math.max(0, Math.min(Math.round(Number(body.position) || 0), 86400));
		const duration = Math.max(0, Math.min(Math.round(Number(body.duration) || 0), 86400));
		const completed = body.completed === true;
		// duration-only beacons pass (loadedmetadata fires before any playback —
		// gives the videos tab a denominator for the 0% case)
		if (seconds === 0 && position === 0 && !completed && duration === 0) return new Response(null, { status: 204 });
		await db
			.update(outreachProspects)
			.set({
				// count the view once, on the first beacon with real playback
				// (SET reads old row values, so watchSeconds=0 here means "first")
				videoViewCount: sql`case when (${seconds} > 0 or ${completed}) and ${outreachProspects.videoWatchSeconds} = 0
					then ${outreachProspects.videoViewCount} + 1 else ${outreachProspects.videoViewCount} end`,
				videoWatchSeconds: sql`least(${outreachProspects.videoWatchSeconds} + ${seconds}, 86400)`,
				videoMaxPosition: sql`greatest(${outreachProspects.videoMaxPosition}, ${position})`,
				videoDurationSeconds: sql`coalesce(${outreachProspects.videoDurationSeconds}, nullif(${duration}, 0))`,
				videoCompleted: sql`${outreachProspects.videoCompleted} or ${completed}`,
				videoLastViewedAt: sql`now()`,
			})
			.where(eq(outreachProspects.id, id));
		return new Response(null, { status: 204 });
	}

	return new Response("Unknown type", { status: 400 });
}
