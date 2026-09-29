// Brain cycle runner — startCycle lives here, NOT in the route file. Solid-start
// compiles each route method with ?pick=<METHOD>, which strips other exports from
// the module: a POST handler referencing a route-file export gets ReferenceError
// at runtime (prod /api/brain/cycle 500'd nightly for exactly this reason, found
// by local repro 2026-09-16).
import { eq } from "drizzle-orm";
import { db } from "~/db";
import { brainJobs } from "~/db/schema";
import { runCycle } from "~/lib/brain/distill";

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
