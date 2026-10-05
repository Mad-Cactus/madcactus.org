// Per-funnel schedule config — what the scheduler pulls and how often.
// GET  /api/funnels/runs/:id/schedule → { schedule } (defaults if never saved)
// PUT  same → upsert { enabled?, discoverySource?, discoveryIntervalDays?, enrichPerDay?, techPerDay? }
import type { APIEvent } from "@solidjs/start/server";
import { eq } from "drizzle-orm";
import { db } from "~/db";
import { funnelSchedules } from "~/db/schema";
import { funnelAuthed, getRunStages } from "~/lib/funnels";

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function scheduleFor(funnelId: string) {
	const [row] = await db.select().from(funnelSchedules).where(eq(funnelSchedules.funnelId, funnelId)).limit(1);
	return row ?? null;
}

export const GET = async (event: APIEvent) => {
	if (!(await funnelAuthed(event.request))) return json({ error: "Unauthorized" }, 401);
	const info = await getRunStages(event.params.id);
	if (!info) return json({ error: "Run not found" }, 404);
	return json({ schedule: await scheduleFor(info.run.funnelId) });
};

export const PUT = async (event: APIEvent) => {
	if (!(await funnelAuthed(event.request))) return json({ error: "Unauthorized" }, 401);
	const info = await getRunStages(event.params.id);
	if (!info) return json({ error: "Run not found" }, 404);
	const body = (await event.request.json().catch(() => ({}))) as {
		enabled?: boolean;
		discoverySource?: string | null;
		discoveryIntervalDays?: number;
		enrichPerDay?: number;
		techPerDay?: number;
	};
	const patch = {
		...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
		...(body.discoverySource === null || body.discoverySource === "fmcsa" ? { discoverySource: body.discoverySource } : {}),
		...(Number.isInteger(body.discoveryIntervalDays) && (body.discoveryIntervalDays as number) > 0 ? { discoveryIntervalDays: body.discoveryIntervalDays } : {}),
		...(Number.isInteger(body.enrichPerDay) && (body.enrichPerDay as number) > 0 ? { enrichPerDay: body.enrichPerDay } : {}),
		...(Number.isInteger(body.techPerDay) && (body.techPerDay as number) > 0 ? { techPerDay: body.techPerDay } : {}),
		updatedAt: new Date(),
	};
	const existing = await scheduleFor(info.run.funnelId);
	if (existing) {
		await db.update(funnelSchedules).set(patch).where(eq(funnelSchedules.id, existing.id));
	} else {
		await db.insert(funnelSchedules).values({ funnelId: info.run.funnelId, ...patch });
	}
	return json({ ok: true, schedule: await scheduleFor(info.run.funnelId) });
};
