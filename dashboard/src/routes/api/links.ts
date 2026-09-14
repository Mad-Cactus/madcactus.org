// Short links admin API — session-guarded.
// GET  /api/links            → [{ slug, target, clicks, createdAt }]
// POST /api/links {target}   → create (slug always generated, never chosen)
// PATCH /api/links {slug,target} → retarget
// DELETE /api/links?slug=x   → remove
import type { APIEvent } from "@solidjs/start/server";
import { desc, eq } from "drizzle-orm";
import { db } from "~/db";
import { shortLinks } from "~/db/schema";
import { randomKey, SLUG_RE, TARGET_RE } from "~/lib/short-links";
import { getAuthedClient } from "~/lib/session";

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}


export const GET = async () => {
	if ((await getAuthedClient()) === null) return json({ error: "Unauthorized" }, 401);
	return json(await db.select().from(shortLinks).orderBy(desc(shortLinks.createdAt)));
};

export const POST = async (event: APIEvent) => {
	if ((await getAuthedClient()) === null) return json({ error: "Unauthorized" }, 401);
	const body = (await event.request.json().catch(() => ({}))) as { target?: string };
	const target = (body.target ?? "").trim();
	if (!TARGET_RE.test(target)) return json({ error: "Target must be an http(s) URL" }, 400);
	// slug is always a generated opaque key — retried on the astronomically rare PK collision
	for (let attempt = 0; attempt < 3; attempt++) {
		const slug = randomKey();
		try {
			await db.insert(shortLinks).values({ slug, target });
			return json({ ok: true, slug, target });
		} catch (e) {
			if (!(e instanceof Error) || !e.message.includes("duplicate key")) throw e;
		}
	}
	return json({ error: "Could not generate a unique slug — try again" }, 500);
};

export const PATCH = async (event: APIEvent) => {
	if ((await getAuthedClient()) === null) return json({ error: "Unauthorized" }, 401);
	const body = (await event.request.json().catch(() => ({}))) as { slug?: string; target?: string };
	const slug = (body.slug ?? "").trim().toLowerCase();
	const target = (body.target ?? "").trim();
	if (!SLUG_RE.test(slug)) return json({ error: "Missing or invalid slug" }, 400);
	if (!TARGET_RE.test(target)) return json({ error: "Target must be an http(s) URL" }, 400);
	await db.update(shortLinks).set({ target }).where(eq(shortLinks.slug, slug));
	return json({ ok: true, slug });
};

export const DELETE = async (event: APIEvent) => {
	if ((await getAuthedClient()) === null) return json({ error: "Unauthorized" }, 401);
	const slug = new URL(event.request.url).searchParams.get("slug") ?? "";
	if (!SLUG_RE.test(slug)) return json({ error: "Missing or invalid slug" }, 400);
	await db.delete(shortLinks).where(eq(shortLinks.slug, slug));
	return json({ ok: true });
};
