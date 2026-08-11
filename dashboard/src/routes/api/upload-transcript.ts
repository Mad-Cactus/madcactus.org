import type { APIEvent } from "@solidjs/start/server";
import { getCookie } from "@solidjs/start/http";
import { supabaseAdmin, supabaseService } from "~/lib/supabase";
import { embed } from "~/lib/embeddings";

/** Upload a meeting transcript with searchable text + optional audio.
 *  Creates one document row of type='transcript'.
 *  Admin-only — requires mc-access-token cookie. */
export async function POST(event: APIEvent) {
	const accessToken = getCookie("mc-access-token");
	const refreshToken = getCookie("mc-refresh-token");
	if (!accessToken || !refreshToken) {
		return new Response("Unauthorized", { status: 401 });
	}

	const admin = supabaseAdmin();
	const { data: session } = await admin.auth.setSession({
		access_token: accessToken,
		refresh_token: refreshToken,
	});
	if (!session.session) return new Response("Unauthorized", { status: 401 });

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

	// Embed transcript text for RAG search
	const embedText = [title, description, content].filter(Boolean).join("\n\n");
	let embedding: number[] | undefined;
	try {
		if (embedText.trim()) embedding = await embed(embedText);
	} catch (e) {
		console.error("Embedding failed:", e);
	}

	const { error: dbErr } = await admin.from("documents").insert({
		project_id: projectId,
		type: "transcript",
		title,
		description,
		content: content || null,
		embedding,
		visibility: "client",
		audio_path: audioPath,
		audio_file_name: audioFileName,
	});

	if (dbErr) {
		// Clean up uploaded audio if DB insert failed
		if (audioPath) {
			const svc = supabaseService();
			await svc.storage.from("portal-docs").remove([audioPath]);
		}
		return new Response(`DB error: ${dbErr.message}`, { status: 500 });
	}

	return new Response(null, {
		status: 302,
		headers: { Location: referer },
	});
}
