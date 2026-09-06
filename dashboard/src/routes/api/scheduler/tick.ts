import type { APIEvent } from "@solidjs/start/server";
import { getAuthedClient } from "~/lib/session";
import { tick } from "~/lib/scheduler";

/**
 * Scheduler tick — for external triggers (Supabase cron via pg_net) that wake
 * the auto-stop Fly machine when work is due. The in-process ticker already
 * runs every 60s while the machine is awake; this covers the asleep case.
 * Atomic claims make concurrent ticks (in-process + ping) safe — the second
 * one finds nothing left to claim.
 *
 * POST /api/scheduler/tick   (x-cron-secret: CRON_SECRET, or admin session)
 *   → { ok: true, docs: n, emails: m }
 */
function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const POST = async (event: APIEvent) => {
	const secret = process.env.CRON_SECRET;
	const header = event.request.headers.get("x-cron-secret");
	const bySecret = Boolean(secret) && header === secret;
	if (!bySecret && (await getAuthedClient()) === null) return json({ error: "Unauthorized" }, 401);
	return json({ ok: true, ...(await tick()) });
};
