"use server";

import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "~/db";
import { outreachProspects } from "~/db/schema";

/** Public watch-page lookup (read-only; opens are beaconed by v-watch.js). */
export async function getTrackedVideo(id: string) {
	const [row] = await db
		.select({ id: outreachProspects.id, company: outreachProspects.company, videoUrl: outreachProspects.videoUrl })
		.from(outreachProspects)
		.where(and(eq(outreachProspects.id, id), isNotNull(outreachProspects.videoUrl)))
		.limit(1);
	return row ?? null;
}
