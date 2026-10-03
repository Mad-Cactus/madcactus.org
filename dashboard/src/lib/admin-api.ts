// Admin API-key auth for machine callers (Orca automations, scripts) — same
// rule as brain-mcp: memberless (admin) mc_ keys only.
import { and, eq, sql } from "drizzle-orm";
import { db } from "~/db";
import { apiKeys } from "~/db/schema";
import { hashKey } from "~/lib/crypto";

export async function isAdminApiKey(request: Request): Promise<boolean> {
	const auth = request.headers.get("authorization");
	if (!auth?.startsWith("Bearer ")) return false;
	const rawKey = auth.slice(7);
	if (!rawKey.startsWith("mc_")) return false;
	const [keyRow] = await db
		.select({ id: apiKeys.id })
		.from(apiKeys)
		.where(and(eq(apiKeys.keyHash, hashKey(rawKey)), sql`${apiKeys.revokedAt} IS NULL`))
		.limit(1);
	return !!keyRow;
}

export function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
