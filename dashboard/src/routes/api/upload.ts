import type { APIEvent } from "@solidjs/start/server";
import { supabaseService } from "~/lib/supabase";
import { getAuthedClient } from "~/lib/session";
import { db } from "~/db";
import { documents } from "~/db/schema";
import type { DocumentType } from "~/db/schema";

/** Extract text from file content for full-text search indexing. */
function extractText(fileName: string, mime: string, bytes: ArrayBuffer): string {
	const ext = fileName.split(".").pop()?.toLowerCase();
	// Plain text formats
	if (
		mime.startsWith("text/") ||
		ext === "txt" || ext === "md" || ext === "csv" || ext === "json"
	) {
		return new TextDecoder().decode(bytes);
	}
	// ponytail: PDF/DOCX text extraction would need a lib (pdf-parse, mammoth).
	// For now those store file only — title/description still get indexed.
	return "";
}

/** Upload a file to Supabase Storage and create a document record.
 *  Admin-only — requires mc-access-token cookie. */
export async function POST(event: APIEvent) {
	// Auth via session helper. DB writes go through Drizzle, not the Supabase
	// JS client — migrations grant no privileges to `authenticated`, so
	// PostgREST inserts fail with "permission denied for schema public".
	if (!(await getAuthedClient())) {
		return new Response("Unauthorized", { status: 401 });
	}

	const formData = await event.request.formData();
	const file = formData.get("file") as File;
	const projectId = String(formData.get("project_id") || "");
	const title = String(formData.get("title") || file.name);
	const docType = String(formData.get("doc_type") || "file") as DocumentType;
	const description = String(formData.get("description") || "");
	const referer = String(
		formData.get("_referer") || event.request.headers.get("referer") || "/admin/clients",
	);

	if (!file || !projectId) {
		return new Response("Missing file or project_id", { status: 400 });
	}

	const fileBytes = await file.arrayBuffer();

	// Upload to storage
	const storagePath = `${projectId}/${Date.now()}-${file.name}`;
	const svc = supabaseService();
	const { error: uploadErr } = await svc.storage
		.from("portal-docs")
		.upload(storagePath, fileBytes, {
			contentType: file.type || "application/octet-stream",
		});

	if (uploadErr) {
		return new Response(`Upload failed: ${uploadErr.message}`, { status: 500 });
	}

	// ponytail: no generated search_vector column exists yet; extracted text is
	// stored as plain text. Add a tsvector + trigger when FTS is wired up.
	const content = extractText(file.name, file.type, fileBytes) || null;

	try {
		await db.insert(documents).values({
			projectId,
			type: docType,
			title,
			url: storagePath,
			fileName: file.name,
			fileSize: file.size,
			mimeType: file.type,
			description,
			content,
			visibility: "client",
		});
	} catch (dbErr) {
		// Clean up uploaded file if DB insert failed
		await svc.storage.from("portal-docs").remove([storagePath]);
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
