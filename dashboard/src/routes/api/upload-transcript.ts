import type { APIEvent } from "@solidjs/start/server";
import { supabaseService } from "~/lib/supabase";
import { getAuthedClient } from "~/lib/session";
import { db } from "~/db";
import { documents } from "~/db/schema";

/** Upload a meeting transcript with searchable text + optional audio.
 *  Creates one document row of type='transcript'.
 *  Admin-only — requires mc-access-token cookie. */
export async function POST(event: APIEvent) {
	// Auth via session helper (matches createDocumentLinkAction). DB writes go
	// through Drizzle, not the Supabase JS client — migrations grant no
	// privileges to the `authenticated` role, so PostgREST inserts fail with
	// "permission denied for schema public".
	if (!(await getAuthedClient())) {
		return new Response("Unauthorized", { status: 401 });
	}

	const formData = await event.request.formData();
	const projectId = String(formData.get("project_id") || "");
	const title = String(formData.get("title") || "Untitled Transcript");
	const description = String(formData.get("description") || "");
	const content = String(formData.get("content") || "");
	const referer = String(
		formData.get("_referer") || event.request.headers.get("referer") || "/admin/clients",
	);

	if (!projectId) return new Response("Missing project_id", { status: 400 });

	// Upload audio if provided
	const audioFile = formData.get("audio") as File | null;
	let audioPath: string | null = null;
	let audioFileName: string | null = null;

	if (audioFile && audioFile.size > 0) {
		audioPath = `${projectId}/${Date.now()}-${audioFile.name}`;
		audioFileName = audioFile.name;
		const svc = supabaseService();
		const { error: uploadErr } = await svc.storage
			.from("portal-docs")
			.upload(audioPath, await audioFile.arrayBuffer(), {
				contentType: audioFile.type || "application/octet-stream",
			});
		if (uploadErr) {
			return new Response(`Audio upload failed: ${uploadErr.message}`, { status: 500 });
		}
	}

	// ponytail: no generated search_vector column exists yet; content is stored
	// as plain text. Add a tsvector + trigger when full-text search is wired up.
	try {
		await db.insert(documents).values({
			projectId,
			type: "transcript",
			title,
			description,
			content: content || null,
			visibility: "client",
			audioPath,
			audioFileName,
		});
	} catch (dbErr) {
		// Clean up uploaded audio if DB insert failed
		if (audioPath) {
			const svc = supabaseService();
			await svc.storage.from("portal-docs").remove([audioPath]);
		}
		return new Response(
			`DB error: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
			{ status: 500 },
		);
	}

	return new Response(null, {
		status: 302,
		headers: { Location: referer },
	});
}
