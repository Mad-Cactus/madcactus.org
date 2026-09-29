"use server";

import { and, eq } from "drizzle-orm";
import { db } from "~/db";
import { docs } from "~/db/schema";

/** Public teaser-page lookup (read-only; clicks are counted on the /l/ slug). */
export async function getTeaser(id: string) {
	const [row] = await db
		.select({ id: docs.id, title: docs.title, markdown: docs.markdown })
		.from(docs)
		.where(and(eq(docs.id, id), eq(docs.genre, "teaser")))
		.limit(1);
	return row ?? null;
}
