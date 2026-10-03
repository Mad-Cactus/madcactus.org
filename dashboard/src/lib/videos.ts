// Videos — first-class outreach video domain. Telemetry, watch links, and
// the prospect ownership link all live on the videos row (promoted from 9
// columns on outreach_prospects). /v/:id resolves the video id first, then
// falls back to prospect lookup forever — legacy email links keep working
// and telemetry stays on a single path (serve, never redirect).
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "~/db";
import { outreachProspects, videos, type Video } from "~/db/schema";
import { UUID_RE } from "~/lib/uuid";

export type WatchVideo = {
	/** the videos row id — what the beacon must send, whatever the URL id was */
	id: string;
	title: string;
	description: string | null;
	url: string;
	/** display heading: the prospect company when linked, else the title */
	company: string;
};

/** Resolve a /v/:id path param: video uuid first, then legacy prospect uuid
 *  → that prospect's most recent video. Null when neither matches. */
export async function getVideoForWatch(id: string): Promise<WatchVideo | null> {
	if (!UUID_RE.test(id)) return null;
	const [byVideo] = await db
		.select({
			id: videos.id,
			title: videos.title,
			description: videos.description,
			url: videos.url,
			company: outreachProspects.company,
		})
		.from(videos)
		.leftJoin(outreachProspects, eq(videos.prospectId, outreachProspects.id))
		.where(eq(videos.id, id))
		.limit(1);
	if (byVideo) return { ...byVideo, company: byVideo.company ?? byVideo.title };

	// legacy link: id was the prospect's uuid — serve its latest video
	// (serve, not redirect: telemetry keeps a single id space)
	const [byProspect] = await db
		.select({
			id: videos.id,
			title: videos.title,
			description: videos.description,
			url: videos.url,
			company: outreachProspects.company,
		})
		.from(videos)
		.innerJoin(outreachProspects, eq(videos.prospectId, outreachProspects.id))
		.where(eq(outreachProspects.id, id))
		.orderBy(desc(videos.createdAt))
		.limit(1);
	return byProspect ?? null;
}

/** Latest video linked to a prospect (null when none). */
export async function latestProspectVideo(prospectId: string): Promise<Video | null> {
	const [row] = await db
		.select()
		.from(videos)
		.where(eq(videos.prospectId, prospectId))
		.orderBy(desc(videos.createdAt))
		.limit(1);
	return row ?? null;
}

/** Create a video row (optionally owned by a prospect). */
export async function createVideo(input: {
	title?: string;
	url: string;
	description?: string | null;
	prospectId?: string | null;
	storagePath?: string | null;
}): Promise<Video> {
	const [row] = await db
		.insert(videos)
		.values({
			title: input.title?.trim() || "Untitled video",
			url: input.url,
			description: input.description ?? null,
			prospectId: input.prospectId ?? null,
			storagePath: input.storagePath ?? null,
		})
		.returning();
	return row;
}

/** Set/replace/clear a prospect's video (the old setOutreachVideoAction
 *  semantics, now on the videos table). url="" removes the video row;
 *  url omitted keeps the current url (description-only update). */
export async function setProspectVideo(
	prospectId: string,
	input: { url?: string; description?: string | null; title?: string | null },
): Promise<void> {
	const existing = await latestProspectVideo(prospectId);
	const url = (input.url ?? existing?.url ?? "").trim();
	if (!url) {
		if (existing) await db.delete(videos).where(eq(videos.id, existing.id));
		return;
	}
	if (existing) {
		await db
			.update(videos)
			.set({
				url,
				...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
				...(input.title !== undefined && input.title?.trim() ? { title: input.title.trim() } : {}),
			})
			.where(eq(videos.id, existing.id));
		return;
	}
	const [prospect] = await db
		.select({ company: outreachProspects.company })
		.from(outreachProspects)
		.where(eq(outreachProspects.id, prospectId))
		.limit(1);
	await db.insert(videos).values({
		title: input.title?.trim() || `Outreach video — ${prospect?.company ?? "prospect"}`,
		url,
		description: input.description?.trim() || null,
		prospectId,
	});
}

// ── Telemetry beacons (/api/video-event) ───────────────────────────
// Same semantics as the old prospect-column handlers: open is NOT a view
// (scanners fire it); the first beacon with real playback counts the view.
// Stage side-effect (proposed/sent → watching) resolves video → prospect.

export async function logVideoOpen(videoId: string): Promise<void> {
	await db
		.update(videos)
		.set({
			firstViewedAt: sql`coalesce(${videos.firstViewedAt}, now())`,
			lastViewedAt: sql`now()`,
			status: sql`case when ${videos.status} = 'unwatched' then 'watching' else ${videos.status} end`,
		})
		.where(eq(videos.id, videoId));
	await flipProspectToWatching(videoId);
}

export async function logVideoWatch(
	videoId: string,
	data: { seconds: number; position: number; duration: number; completed: boolean },
): Promise<void> {
	const { seconds, position, duration, completed } = data;
	// duration-only beacons (loadedmetadata) pass — gives the videos tab a
	// denominator for the 0% case
	if (seconds === 0 && position === 0 && !completed && duration === 0) return;
	await db
		.update(videos)
		.set({
			// count the view once, on the first beacon with real playback
			// (SET reads old row values, so watchSeconds=0 here means "first")
			viewCount: sql`case when (${seconds} > 0 or ${completed}) and ${videos.watchSeconds} = 0
				then ${videos.viewCount} + 1 else ${videos.viewCount} end`,
			watchSeconds: sql`least(${videos.watchSeconds} + ${seconds}, 86400)`,
			maxPosition: sql`greatest(${videos.maxPosition}, ${position})`,
			durationSeconds: sql`coalesce(${videos.durationSeconds}, nullif(${duration}, 0))`,
			completed: sql`${videos.completed} or ${completed}`,
			lastViewedAt: sql`now()`,
			status: sql`case
				when (${videos.completed} or ${completed}) then 'completed'
				when (${seconds} > 0 or ${position} > 0 or ${videos.watchSeconds} > 0 or ${videos.maxPosition} > 0) then 'watched'
				else ${videos.status} end`,
		})
		.where(eq(videos.id, videoId));
}

async function flipProspectToWatching(videoId: string): Promise<void> {
	// stage literals from OUTREACH_STAGES — static, safe to inline.
	// UPDATE … FROM: resolves video → prospect in one statement (drizzle's
	// update builder can't join).
	await db.execute(sql`
		update outreach_prospects p
		set stage = case when p.stage in ('proposed', 'sent') then 'watching' else p.stage end,
		    updated_at = now()
		from videos v
		where v.id = ${videoId} and v.prospect_id = p.id
	`);
}
