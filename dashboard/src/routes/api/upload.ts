import type { APIEvent } from "@solidjs/start/server";
import { getCookie } from "@solidjs/start/http";
import { supabaseAdmin, supabaseService } from "~/lib/supabase";
import { embed } from "~/lib/embeddings";

/** Extract text from file content for embedding. */
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
	// For now those store file only — title/description still get embedded.
	return "";
}

/** Upload a file to Supabase Storage and create a document record.
 *  Admin-only — requires mc-access-token cookie. */
export async function POST(event: APIEvent) {
	const accessToken = getCookie("mc-access-token");
	const refreshToken = getCookie("mc-refresh-token");
	if (!accessToken || !refreshToken) {
		return new Response("Unauthorized", { status: 401 });
	}

	// Verify admin session
	const admin = supabaseAdmin();
	const { data: session } = await admin.auth.setSession({
		access_token: accessToken,
		refresh_token: refreshToken,
	});
	if (!session.session) return new Response("Unauthorized", { status: 401 });

	const formData = await event.request.formData();
	const file = formData.get("file") as File;
	const projectId = String(formData.get("project_id") || "");
	const title = String(formData.get("title") || file.name);
	const docType = String(formData.get("doc_type") || "file");
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

	// Extract text + generate embedding
	const extractedText = extractText(file.name, file.type, fileBytes);
	const embedText = [title, description, extractedText].filter(Boolean).join("\n\n");
	let embedding: number[] | undefined;
	let content: string | null = extractedText || null;
	try {
		if (embedText.trim()) embedding = await embed(embedText);
	} catch (e) {
		console.error("Embedding failed:", e);
	}

	// Create document record
	const { error: dbErr } = await admin.from("documents").insert({
		project_id: projectId,
		type: docType,
		title,
		url: storagePath,
		file_name: file.name,
		file_size: file.size,
		mime_type: file.type,
		description,
		content,
		embedding,
		visibility: "client",
	});

	if (dbErr) {
		return new Response(`DB error: ${dbErr.message}`, { status: 500 });
	}

	return new Response(null, {
		status: 302,
		headers: { Location: referer },
	});
}
