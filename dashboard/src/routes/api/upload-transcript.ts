import type { APIEvent } from "@solidjs/start/server";
import { and, eq, sql } from "drizzle-orm";
import { createHash } from "crypto";
import { supabaseService } from "~/lib/supabase";
import { getAuthedClient } from "~/lib/session";
import { db } from "~/db";
import { apiKeys, documents } from "~/db/schema";

/** Upload a meeting transcript with searchable text + optional audio.
 *  Creates one document row of type='transcript'.
 *  Auth: admin session cookie (form UX) OR `Authorization: Bearer mc_<key>`
 *  (used by the Anarlog meeting publisher to push visibility='draft' rows).
 *  Bearer requests get JSON; cookie requests get a 302 back to the referer. */
export async function POST(event: APIEvent) {
	const request = event.request;
	const authHeader = request.headers.get("authorization") || "";
	const isBearer = authHeader.startsWith("Bearer mc_");

	if (isBearer) {
		const keyHash = createHash("sha256").update(authHeader.slice(7)).digest("hex");
		const [keyRow] = await db
			.select({ id: apiKeys.id })
			.from(apiKeys)
			.where(and(eq(apiKeys.keyHash, keyHash), sql`${apiKeys.revokedAt} IS NULL`))
			.limit(1);
		if (!keyRow) return json({ error: "Invalid API key" }, 401);
		db.update(apiKeys)
			.set({ lastUsedAt: new Date() })
			.where(eq(apiKeys.id, keyRow.id))
			.then(() => {})
			.catch(() => {});
	} else if (!(await getAuthedClient())) {
		return new Response("Unauthorized", { status: 401 });
	}

	const formData = await request.formData();
	const projectId = String(formData.get("project_id") || "") || null;
	const title = String(formData.get("title") || "Untitled Transcript");
	const description = String(formData.get("description") || "");
	const content = String(formData.get("content") || "");
	const transcriptJson = String(formData.get("transcript_json") || "") || null;
	const visibility = String(formData.get("visibility") || "client");
	const referer = String(
		formData.get("_referer") || request.headers.get("referer") || "/admin/clients",
	);

	if (visibility !== "client" && visibility !== "draft") {
		return isBearer
			? json({ error: "visibility must be 'client' or 'draft'" }, 400)
			: new Response("Invalid visibility", { status: 400 });
	}
	// client-visible docs must belong to a project; drafts are assigned at
	// publish time in /admin/meetings
	if (!projectId && visibility === "client") {
		return isBearer
			? json({ error: "Missing project_id" }, 400)
			: new Response("Missing project_id", { status: 400 });
	}
	if (transcriptJson !== null) {
		try {
			const parsed: unknown = JSON.parse(transcriptJson);
			if (!Array.isArray(parsed)) throw new Error("not an array");
		} catch {
			return isBearer
				? json({ error: "transcript_json must be a JSON array of blocks" }, 400)
				: new Response("Invalid transcript_json", { status: 400 });
		}
	}

	// Upload audio if provided
	const audioFile = formData.get("audio") as File | null;
	let audioPath: string | null = null;
	let audioFileName: string | null = null;

	if (audioFile && audioFile.size > 0) {
		audioPath = `meetings/${Date.now()}-${(audioFile.name || "audio.mp3").replace(/[^a-zA-Z0-9._-]/g, "_")}`;
		audioFileName = audioFile.name || "audio.mp3";
		const svc = supabaseService();
		const { error: uploadErr } = await svc.storage
			.from("portal-docs")
			.upload(audioPath, await audioFile.arrayBuffer(), {
				contentType: audioFile.type || "audio/mpeg",
			});
		if (uploadErr) {
			return isBearer
				? json({ error: `Audio upload failed: ${uploadErr.message}` }, 500)
				: new Response(`Audio upload failed: ${uploadErr.message}`, { status: 500 });
		}
	}

	// ponytail: no generated search_vector column exists yet; content is stored
	// as plain text. Add a tsvector + trigger when full-text search is wired up.
	try {
		const [row] = await db
			.insert(documents)
			.values({
				projectId,
				type: "transcript",
				title,
				description,
				content: content || null,
				visibility,
				audioPath,
				audioFileName,
				transcriptJson,
			})
			.returning({ id: documents.id });
		if (isBearer) return json({ ok: true, id: row.id }, 201);
		return new Response(null, {
			status: 302,
			headers: { Location: referer },
		});
	} catch (dbErr) {
		// Clean up uploaded audio if DB insert failed
		if (audioPath) {
			const svc = supabaseService();
			await svc.storage.from("portal-docs").remove([audioPath]);
		}
		const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
		return isBearer ? json({ error: `DB error: ${msg}` }, 500) : new Response(`DB error: ${msg}`, { status: 500 });
	}
}

function json(body: unknown, status: number) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}
