"use server";

// Share-page doc lookup lives in a "use server" file so the client bundle gets
// an RPC stub instead of docs.ts's db + loro-crdt chain (same fix as
// watch-video.ts — Buffer crash at chunk eval).
import { eq } from "drizzle-orm";
import { db } from "~/db";
import { docs, type Doc } from "~/db/schema";

export async function getDocByShareToken(token: string): Promise<Doc | null> {
	const [row] = await db.select().from(docs).where(eq(docs.shareToken, token));
	return row ?? null;
}
