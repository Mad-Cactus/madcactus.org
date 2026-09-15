// Short links admin API — session-guarded.
// GET    /api/links                  → { links: [...joined with doc], docs: [attachable post/newsletter list] }
// POST   /api/links {target, docId?} → create (slug always generated, never chosen)
// PATCH  /api/links {slug, target, docId?} → retarget and/or attach/detach (docId: null detaches)
// DELETE /api/links?slug=x           → remove
import type { APIEvent } from "@solidjs/start/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "~/db";
import { docs, shortLinks } from "~/db/schema";
import { randomKey, SLUG_RE, TARGET_RE } from "~/lib/short-links";
import { getAuthedClient } from "~/lib/session";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function validDocId(docId: string): Promise<boolean> {
	if (!UUID_RE.test(docId)) return false;
	const [doc] = await db
		.select({ id: docs.id })
		.from(docs)
		.where(and(eq(docs.id, docId), inArray(docs.kind, ["post", "newsletter"])))
		.limit(1);
	return Boolean(doc);
}

export const GET = async () => {
	if ((await getAuthedClient()) === null) return json({ error: "Unauthorized" }, 401);
	const [links, attachable] = await Promise.all([
		db
			.select({
				slug: shortLinks.slug,
				target: shortLinks.target,
				clicks: shortLinks.clicks,
				docId: shortLinks.docId,
				docTitle: docs.title,
				docKind: docs.kind,
				createdAt: shortLinks.createdAt,
			})
			.from(shortLinks)
			.leftJoin(docs, eq(shortLinks.docId, docs.id))
			.orderBy(desc(shortLinks.createdAt)),
		db
			.select({ id: docs.id, title: docs.title, kind: docs.kind, publishedAt: docs.publishedAt })
			.from(docs)
			.where(inArray(docs.kind, ["post", "newsletter"]))
			.orderBy(desc(docs.updatedAt))
			.limit(200),
	]);
	return json({ links, docs: attachable });
};

export const POST = async (event: APIEvent) => {
	if ((await getAuthedClient()) === null) return json({ error: "Unauthorized" }, 401);
	const body = (await event.request.json().catch(() => ({}))) as { target?: string; docId?: string | null };
	const target = (body.target ?? "").trim();
	if (!TARGET_RE.test(target)) return json({ error: "Target must be an http(s) URL" }, 400);
	let docId: string | null = null;
	if (typeof body.docId === "string" && body.docId) {
		if (!(await validDocId(body.docId))) return json({ error: "docId must be an existing post/newsletter" }, 400);
		docId = body.docId;
	}
	// slug is always a generated opaque key — retried on the astronomically rare PK collision
	for (let attempt = 0; attempt < 3; attempt++) {
		const slug = randomKey();
		try {
			await db.insert(shortLinks).values({ slug, target, docId });
			return json({ ok: true, slug, target });
		} catch (e) {
			if (!(e instanceof Error) || !e.message.includes("duplicate key")) throw e;
		}
	}
	return json({ error: "Could not generate a unique slug — try again" }, 500);
};

export const PATCH = async (event: APIEvent) => {
	if ((await getAuthedClient()) === null) return json({ error: "Unauthorized" }, 401);
	const body = (await event.request.json().catch(() => ({}))) as {
		slug?: string;
		target?: string;
		docId?: string | null;
	};
	// no toLowerCase() — slugs are mixed-case opaque keys; lowercasing breaks the where-match
	const slug = (body.slug ?? "").trim();
	const target = (body.target ?? "").trim();
	if (!SLUG_RE.test(slug)) return json({ error: "Missing or invalid slug" }, 400);
	if (!TARGET_RE.test(target)) return json({ error: "Target must be an http(s) URL" }, 400);
	let docId: string | null = null;
	if (typeof body.docId === "string" && body.docId) {
		if (!(await validDocId(body.docId))) return json({ error: "docId must be an existing post/newsletter" }, 400);
		docId = body.docId;
	}
	await db.update(shortLinks).set({ target, docId }).where(eq(shortLinks.slug, slug));
	return json({ ok: true, slug });
};

export const DELETE = async (event: APIEvent) => {
	if ((await getAuthedClient()) === null) return json({ error: "Unauthorized" }, 401);
	const slug = new URL(event.request.url).searchParams.get("slug") ?? "";
	if (!SLUG_RE.test(slug)) return json({ error: "Missing or invalid slug" }, 400);
	await db.delete(shortLinks).where(eq(shortLinks.slug, slug));
	return json({ ok: true });
};
