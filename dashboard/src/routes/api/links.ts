// Short links admin API — session-guarded.
// GET  /api/links            → [{ slug, target, clicks, createdAt }]
// POST /api/links {slug,target} → upsert (create or retarget)
// PATCH /api/links {slug,newSlug?,target} → rename slug and/or retarget
// DELETE /api/links?slug=x   → remove
import type { APIEvent } from "@solidjs/start/server";
import { desc, eq } from "drizzle-orm";
import { db } from "~/db";
import { shortLinks } from "~/db/schema";
import { getAuthedClient } from "~/lib/session";

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// slug doubles as a URL path segment — keep it boring. target is admin input
// but still must be an http(s) URL (no javascript: etc. via redirect).
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,48}$/;
const TARGET_RE = /^https?:\/\//i;

// Dub-style opaque keys: 7 chars, nanoid custom-alphabet style, lookalikes
// (0 O 1 l I i o) dropped so a misread link never dead-ends. 54^7 ≈ 1.3e12.
const KEY_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
function randomKey(len = 7): string {
	let out = "";
	for (let i = 0; i < len; i++) out += KEY_ALPHABET[Math.floor(Math.random() * KEY_ALPHABET.length)];
	return out;
}

export const GET = async () => {
	if ((await getAuthedClient()) === null) return json({ error: "Unauthorized" }, 401);
	return json(await db.select().from(shortLinks).orderBy(desc(shortLinks.createdAt)));
};

export const POST = async (event: APIEvent) => {
	if ((await getAuthedClient()) === null) return json({ error: "Unauthorized" }, 401);
	const body = (await event.request.json().catch(() => ({}))) as { slug?: string; target?: string };
	const requested = (body.slug ?? "").trim().toLowerCase();
	const target = (body.target ?? "").trim();
	if (requested && !SLUG_RE.test(requested))
		return json({ error: "Slug must be lowercase letters, digits, dashes (max 49)" }, 400);
	if (!TARGET_RE.test(target)) return json({ error: "Target must be an http(s) URL" }, 400);
	// explicit slug → upsert (create or retarget); blank → Dub-style opaque key,
	// retried on the astronomically rare PK collision
	if (requested) {
		await db.insert(shortLinks).values({ slug: requested, target }).onConflictDoUpdate({ target: shortLinks.slug, set: { target } });
		return json({ ok: true, slug: requested, target });
	}
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
	const body = (await event.request.json().catch(() => ({}))) as { slug?: string; newSlug?: string; target?: string };
	const slug = (body.slug ?? "").trim().toLowerCase();
	const newSlug = (body.newSlug ?? slug).trim().toLowerCase();
	const target = (body.target ?? "").trim();
	if (!SLUG_RE.test(slug) || !SLUG_RE.test(newSlug))
		return json({ error: "Slug must be lowercase letters, digits, dashes (max 49)" }, 400);
	if (!TARGET_RE.test(target)) return json({ error: "Target must be an http(s) URL" }, 400);
	try {
		await db.update(shortLinks).set({ slug: newSlug, target }).where(eq(shortLinks.slug, slug));
	} catch (e) {
		if (e instanceof Error && e.message.includes("duplicate key"))
			return json({ error: "That slug is already taken" }, 409);
		throw e;
	}
	return json({ ok: true, slug: newSlug });
};

export const DELETE = async (event: APIEvent) => {
	if ((await getAuthedClient()) === null) return json({ error: "Unauthorized" }, 401);
	const slug = new URL(event.request.url).searchParams.get("slug") ?? "";
	if (!SLUG_RE.test(slug)) return json({ error: "Missing or invalid slug" }, 400);
	await db.delete(shortLinks).where(eq(shortLinks.slug, slug));
	return json({ ok: true });
};
