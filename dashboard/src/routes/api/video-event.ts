import type { APIEvent } from "@solidjs/start/server";
import { eq, sql } from "drizzle-orm";
import { db } from "~/db";
import { outreachProspects } from "~/db/schema";

// Beacon receiver for watch pages (/v/:id + public/v-watch.js).
// open  → view count +1, first/last timestamps, sent → watching
// watch → real played seconds (native <video> events; client is untrusted)
//         plus max position reached, duration, completion
export async function POST(event: APIEvent) {
	let body: { id?: string; type?: string; seconds?: number; position?: number; duration?: number; completed?: boolean };
	try {
		body = await event.request.json();
	} catch {
		return new Response("Bad JSON", { status: 400 });
	}

	const id = body.id ?? "";
	const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
	if (!isUuid) return new Response("Bad id", { status: 400 });

	if (body.type === "open") {
		await db
			.update(outreachProspects)
			.set({
				videoViewCount: sql`${outreachProspects.videoViewCount} + 1`,
				videoFirstViewedAt: sql`coalesce(${outreachProspects.videoFirstViewedAt}, now())`,
				videoLastViewedAt: sql`now()`,
				stage: sql`case when ${outreachProspects.stage} = 'sent' then 'watching' else ${outreachProspects.stage} end`,
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
		if (seconds === 0 && position === 0 && !completed) return new Response(null, { status: 204 });
		await db
			.update(outreachProspects)
			.set({
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
