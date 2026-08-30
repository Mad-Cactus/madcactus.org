import type { APIEvent } from "@solidjs/start/server";
import { checkApiKey } from "~/lib/api-key";
import { db } from "~/db";
import { companies } from "~/db/schema";

/** List clients + pseudonyms for the Anarlog meeting publisher's title filter.
 *  Auth: `Authorization: Bearer mc_<key>` (same scheme as /api/mcp). */
export async function GET(event: APIEvent) {
	if (!(await checkApiKey(event.request))) {
		return Response.json({ error: "Invalid API key" }, { status: 401 });
	}
	const rows = await db
		.select({ name: companies.name, aliases: companies.aliases })
		.from(companies);
	return Response.json({
		clients: rows.map((r) => ({
			name: r.name,
			aliases: r.aliases ? (JSON.parse(r.aliases) as string[]) : [],
		})),
	});
}
