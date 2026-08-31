import type { APIEvent } from "@solidjs/start/server";
import { $ } from "bun";
import { supabaseService } from "~/lib/supabase";
import { getAuthedClient } from "~/lib/session";
import { checkApiKey } from "~/lib/api-key";
import { db } from "~/db";
import { documents } from "~/db/schema";

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
		if (!(await checkApiKey(request))) {
			return json({ error: "Invalid API key" }, 401);
		}
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

	// Supabase Free plan caps EVERY storage object at 50MB globally — bucket
	// limits can't override it. Re-encode oversized audio to mono AAC sized to
	// land under the cap. ponytail: when meetings outgrow ~7h or storage nears
	// the 1GB Free quota, move audio to R2 or upgrade the plan.
	const REENCODE_THRESHOLD = 45 * 1024 * 1024;

	if (audioFile && audioFile.size > 0) {
		audioFileName = audioFile.name;
		let bytes: Uint8Array<ArrayBuffer> = new Uint8Array(await audioFile.arrayBuffer());
		let contentType = audioFile.type || "application/octet-stream";

		if (bytes.byteLength > REENCODE_THRESHOLD) {
			const encoded = await reencodeAudio(bytes);
			if (encoded) {
				bytes = encoded;
				contentType = "audio/mp4";
			}
			// encoded === null → ffmpeg unavailable/failed; upload the original
			// as-is and let storage surface the size error.
		}

		const ext = contentType === "audio/mp4" ? ".m4a" : extOf(audioFile.name);
		// drafts have no project yet — staged under meetings/ until the publish
		// action relocates them under the assigned project's prefix
		audioPath = `${projectId ?? "meetings"}/${Date.now()}-${baseName(audioFile.name)}${ext}`;
		const svc = supabaseService();
		const { error: uploadErr } = await svc.storage
			.from("portal-docs")
			.upload(audioPath, bytes, {
				contentType,
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

/** Transcode audio to mono AAC sized to fit under the 50MB storage cap.
 *  Bitrate comes from the input duration so any meeting length fits in one
 *  pass (48kbps ceiling, 16kbps floor ≈ 7h+ before it can't).
 *  Returns null if ffmpeg is missing or fails — caller uploads the original. */
async function reencodeAudio(input: Uint8Array): Promise<Uint8Array<ArrayBuffer> | null> {
	const TARGET_BYTES = 45 * 1024 * 1024;
	const dir = `${process.env.TMPDIR ?? "/tmp"}/mc-audio-${Date.now()}-${crypto.randomUUID()}`;
	try {
		await $`mkdir -p ${dir}`.quiet();
		const inPath = `${dir}/in`;
		const outPath = `${dir}/out.m4a`;
		await Bun.write(inPath, input);

		const durationSec = Number(
			(
				await $`ffprobe -v error -show_entries format=duration -of csv=p=0 ${inPath}`
					.quiet()
					.text()
			).trim(),
		);
		if (!Number.isFinite(durationSec) || durationSec <= 0) return null;

		const kbps = Math.min(48, Math.max(16, Math.floor((TARGET_BYTES * 8) / durationSec / 1000)));
		await $`ffmpeg -y -v error -i ${inPath} -c:a aac -b:a ${kbps}k -ac 1 ${outPath}`.quiet();

		const out = new Uint8Array(await Bun.file(outPath).arrayBuffer());
		return out.byteLength < input.byteLength ? out : null;
	} catch (e) {
		console.error("audio re-encode failed:", e);
		return null;
	} finally {
		await $`rm -rf ${dir}`.quiet();
	}
}

function baseName(name: string): string {
	const i = name.lastIndexOf(".");
	return i > 0 ? name.slice(0, i) : name;
}

function extOf(name: string): string {
	const i = name.lastIndexOf(".");
	return i > 0 ? name.slice(i) : "";
}
