import type { APIEvent } from "@solidjs/start/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { hashKey } from "~/lib/crypto";
import { db } from "~/db";
import { apiKeys, brainJobs } from "~/db/schema";
import { getAuthedClient } from "~/lib/session";
import { runCycle } from "~/lib/brain/distill";

/**
 * Brain cycle trigger for schedulers (Supabase cron / GitHub Actions / Fly
 * scheduled machine). Auth: either an admin (memberless) mc_ API key, or
 * `x-cron-secret` header matching the CRON_SECRET env — a shared secret is
 * easier for schedulers that can't hold an API key shape.
 *
 * POST /api/brain/cycle
 *   Starts a cycle and returns immediately: 202 { id } — poll GET ?id=<id>.
 *   { "wait": true } runs synchronously and returns the full result (admin
 *   page buttons; callers that can hold a connection open).
 *   { "reprocessTranscripts": true } re-distills all transcripts (e.g. after
 *   diarization improved), expiring the old document-sourced facts first.
 *
 * GET /api/brain/cycle?id=<uuid>  → one run (status + result)
 * GET /api/brain/cycle            → the 10 most recent runs
 *
 * Runs are tracked as brain_jobs rows (phase='cycle') so any client — cron,
 * MCP agent, admin page — can start and poll without holding a connection.
 */

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function authorize(request: Request): Promise<boolean> {
	// dashboard session (admin page buttons)
	if (await getAuthedClient()) return true;
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

export async function startCycle(opts: {
	wait?: boolean;
	reprocessTranscripts?: boolean;
	slack: boolean;
}): Promise<{ id: string } | Record<string, unknown>> {
	const [job] = await db
		.insert(brainJobs)
		.values({ phase: "cycle", status: "running", payload: { reprocessTranscripts: opts.reprocessTranscripts === true } })
		.returning({ id: brainJobs.id });

	const run = async () => {
		try {
			const result = await runCycle({
				reprocessTranscripts: opts.reprocessTranscripts,
				slack: opts.slack,
			});
			await db
				.update(brainJobs)
				.set({ status: "done", payload: result, error: null })
				.where(eq(brainJobs.id, job.id));
		} catch (e) {
			await db
				.update(brainJobs)
				.set({ status: "failed", error: e instanceof Error ? e.message : String(e) })
				.where(eq(brainJobs.id, job.id));
		}
	};

	if (opts.wait) {
		await run();
		const [row] = await db.select().from(brainJobs).where(eq(brainJobs.id, job.id));
		return { ok: true, cycle: row?.payload ?? {} };
	}
	void run();
	return { id: job.id };
}

export const POST = async (event: APIEvent) => {
	if (!(await authorize(event.request))) return json({ error: "Unauthorized" }, 401);
	const body = (await event.request.json().catch(() => ({}))) as {
		wait?: boolean;
		reprocessTranscripts?: boolean;
		slack?: boolean;
	};
	const result = await startCycle({
		wait: body.wait === true,
		reprocessTranscripts: body.reprocessTranscripts === true,
		slack: body.slack !== false, // schedulers + admin default to syncing slack
	});
	return json(result, body.wait ? 200 : 202);
};

export const GET = async (event: APIEvent) => {
	if (!(await authorize(event.request))) return json({ error: "Unauthorized" }, 401);
	const id = new URL(event.request.url).searchParams.get("id");
	if (id) {
		const [row] = await db.select().from(brainJobs).where(eq(brainJobs.id, id));
		if (!row) return json({ error: "not found" }, 404);
		return json({
			id: row.id,
			status: row.status,
			result: row.status === "done" ? row.payload : null,
			error: row.error,
			startedAt: row.createdAt,
			updatedAt: row.updatedAt,
		});
	}
	const rows = await db
		.select()
		.from(brainJobs)
		.where(eq(brainJobs.phase, "cycle"))
		.orderBy(desc(brainJobs.createdAt))
		.limit(10);
	return json({ runs: rows.map((r) => ({ id: r.id, status: r.status, startedAt: r.createdAt, updatedAt: r.updatedAt })) });
};
