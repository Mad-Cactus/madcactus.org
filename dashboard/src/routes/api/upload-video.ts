import type { APIEvent } from "@solidjs/start/server";
import { supabaseService } from "~/lib/supabase";
import { getAuthedClient } from "~/lib/session";

// Video files for outreach watch pages (/v/[id]). Bucket + per-file cap are
// ensured here (idempotent) instead of a hand-written migration — AGENTS.md
// reserves migrations for drizzle-generated schema changes only.
const BUCKET = "videos";
// Supabase free plan hard-caps a single upload at 50MB — the API rejects any
// bucket file_size_limit above that (the 150MiB portal-docs bucket was made
// via SQL, which skips the check; uploads past 50MB still fail server-side).
// ponytail: bigger videos need a compressed export, the Pro plan, or a
// different store (Fly volume / Bunny); route shape stays the same.
const MAX_BYTES = 50 * 1024 * 1024;

async function ensureBucket() {
	const { error } = await supabaseService().storage.createBucket(BUCKET, {
		public: true,
		fileSizeLimit: MAX_BYTES,
	});
	// "already exists" is the happy path after the first upload; anything
	// else is a real failure.
	if (error && !/exists/i.test(error.message)) {
		throw new Error(`bucket: ${error.message}`);
	}
}

/** Upload a video file for a prospect's watch page. Admin-only.
 *  Body is the RAW file (no multipart): supabase-js upload() buffers the
 *  whole file in memory and the Fly machine has 512MB — stream instead.
 *  ponytail: Supabase free tier ceilings — 1GB storage, 5GB egress/mo.
 *  If the video library or watch traffic outgrows that, move to a Fly
 *  volume or Bunny Stream; route shape stays the same. */
export async function POST(event: APIEvent) {
	if (!(await getAuthedClient())) {
		return new Response("Unauthorized", { status: 401 });
	}

	const name = new URL(event.request.url).searchParams.get("name") ?? "recording.mp4";
	if (!/\.(mp4|mov|webm)$/i.test(name)) {
		return Response.json({ error: "Only .mp4/.mov/.webm files are supported" }, { status: 400 });
	}

	await ensureBucket();

	const path = `${Date.now()}-${name.replace(/[/\\]/g, "-")}`;
	const res = await fetch(
		`${process.env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(path)}`,
		{
			method: "POST",
			headers: {
				// New-style sb_secret_ keys must ride the apikey header too —
				// Authorization alone gets "Invalid Compact JWS" from storage.
				apikey: process.env.SUPABASE_SERVICE_KEY,
				Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
				"Content-Type": event.request.headers.get("Content-Type") ?? "video/mp4",
			},
			// Streams straight through — a 500MB file never fully buffers.
			body: event.request.body,
			duplex: "half",
		} as RequestInit,
	);

	if (!res.ok) {
		return Response.json({ error: `Upload failed: ${await res.text()}` }, { status: 500 });
	}
	const { data } = supabaseService().storage.from(BUCKET).getPublicUrl(path);
	return Response.json({ url: data.publicUrl });
}
