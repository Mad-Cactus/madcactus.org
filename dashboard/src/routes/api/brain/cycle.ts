import type { APIEvent } from "@solidjs/start/server";
import { and, eq, sql } from "drizzle-orm";
import { hashKey } from "~/lib/crypto";
import { db } from "~/db";
import { apiKeys } from "~/db/schema";
import { runCycle } from "~/lib/brain/distill";

/**
 * Brain cycle trigger for schedulers (Supabase cron / GitHub Actions / Fly
 * scheduled machine). Auth: either an admin (memberless) mc_ API key, or
 * `x-cron-secret` header matching the CRON_SECRET env — a shared secret is
 * easier for schedulers that can't hold an API key shape.
 *
 * POST /api/brain/cycle
 *   { "reprocessTranscripts": true } — re-distill all transcripts (e.g. after
 *   diarization improved), expiring the old document-sourced facts first.
 */

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function authorize(request: Request): Promise<boolean> {
	const secret = process.env.CRON_SECRET;
	const header = request.headers.get("x-cron-secret");
	if (secret && header && header === secret) return true;

	const auth = request.headers.get("authorization");
	if (!auth?.startsWith("Bearer ")) return false;
	const rawKey = auth.slice(7);
	if (!rawKey.startsWith("mc_")) return false;
	const [keyRow] = await db
		.select({ id: apiKeys.id, memberId: apiKeys.memberId })
		.from(apiKeys)
		.where(and(eq(apiKeys.keyHash, hashKey(rawKey)), sql`${apiKeys.revokedAt} IS NULL`))
		.limit(1);
	return !!keyRow && keyRow.memberId === null;
}

export const POST = async (event: APIEvent) => {
	if (!(await authorize(event.request))) return json({ error: "Unauthorized" }, 401);
	const body = (await event.request.json().catch(() => ({}))) as { reprocessTranscripts?: boolean };
	const result = await runCycle({ reprocessTranscripts: body.reprocessTranscripts === true });
	return json({ ok: true, cycle: result });
};
