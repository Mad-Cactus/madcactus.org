import { and, eq, sql } from "drizzle-orm";
import { db } from "~/db";
import { apiKeys } from "~/db/schema";

/** Validate `Authorization: Bearer mc_<key>` from a request.
 *  Touches last_used_at on success. Returns true if the key is valid and
 *  unrevoked. Shared by the API routes that accept key auth. */
export async function checkApiKey(request: Request): Promise<boolean> {
	const auth = request.headers.get("authorization") || "";
	if (!auth.startsWith("Bearer mc_")) return false;
	const keyHash = new Bun.CryptoHasher("sha256").update(auth.slice(7)).digest("hex");
	const [keyRow] = await db
		.select({ id: apiKeys.id })
		.from(apiKeys)
		.where(and(eq(apiKeys.keyHash, keyHash), sql`${apiKeys.revokedAt} IS NULL`))
		.limit(1);
	if (!keyRow) return false;
	db.update(apiKeys)
		.set({ lastUsedAt: new Date() })
		.where(eq(apiKeys.id, keyRow.id))
		.then(() => {})
		.catch(() => {});
	return true;
}
