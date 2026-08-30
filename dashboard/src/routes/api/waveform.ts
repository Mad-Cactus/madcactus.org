import type { APIEvent } from "@solidjs/start/server";
import { spawn } from "node:child_process";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCookie } from "@solidjs/start/http";
import { supabaseAdmin, supabaseService } from "~/lib/supabase";

const BUCKET_COUNT = 2400; // ~1.5s per bucket for a 1h meeting
const SAMPLE_RATE = 8000;

/** Waveform peaks for the meeting draft editor's scrub bar.
 *  Auth: admin session (same as /api/download). Result is cached in storage
 *  next to the audio as `<path>.peaks.json` — computed once per file. */
export async function GET(event: APIEvent) {
	// admin check, mirroring download.ts
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

	const path = new URL(event.request.url).searchParams.get("path");
	if (!path) return new Response("Missing path", { status: 400 });

	const svc = supabaseService();

	// cache hit?
	const cachePath = `${path}.peaks.json`;
	const { data: cached } = await svc.storage.from("portal-docs").download(cachePath);
	if (cached) {
		return Response.json(JSON.parse(await cached.text()), {
			headers: { "cache-control": "private, max-age=3600" },
		});
	}

	// pull audio, decode to mono s16le PCM via ffmpeg
	const { data: blob, error: dlErr } = await svc.storage.from("portal-docs").download(path);
	if (dlErr || !blob) return new Response("Audio not found", { status: 404 });

	const dir = await mkdtemp(join(tmpdir(), "mc-wave-"));
	try {
		const inPath = join(dir, "in.audio");
		const pcmPath = join(dir, "pcm.raw");
		await writeFile(inPath, Buffer.from(await blob.arrayBuffer()));

		await new Promise<void>((resolve, reject) => {
			spawn(
				"ffmpeg",
				[
					"-hide_banner", "-loglevel", "error",
					"-i", inPath,
					"-ac", "1", "-ar", String(SAMPLE_RATE),
					"-f", "s16le", "-acodec", "pcm_s16le",
					"-y", pcmPath,
				],
				{ timeout: 300_000 },
			).on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))))
				.on("error", reject);
		});

		const pcm = await readFile(pcmPath);
		const samples = pcm.length / 2; // int16 LE
		const per = Math.max(1, Math.floor(samples / BUCKET_COUNT));
		const peaks = new Array<number>(BUCKET_COUNT * 2);
		for (let b = 0; b < BUCKET_COUNT; b++) {
			let min = 1;
			let max = -1;
			for (let i = 0; i < per; i++) {
				const off = (b * per + i) * 2;
				if (off + 1 >= pcm.length) break;
				const v = pcm.readInt16LE(off) / 32768;
				if (v < min) min = v;
				if (v > max) max = v;
			}
			peaks[b * 2] = min === 1 && max === -1 ? 0 : min;
			peaks[b * 2 + 1] = min === 1 && max === -1 ? 0 : max;
		}
		const durationMs = Math.round((samples / SAMPLE_RATE) * 1000);

		const body = { peaks, durationMs };
		// fire-and-forget cache write
		svc.storage
			.from("portal-docs")
			.upload(cachePath, JSON.stringify(body), {
				contentType: "application/json",
				upsert: true,
			})
			.then(() => {})
			.catch(() => {});
		return Response.json(body, { headers: { "cache-control": "private, max-age=3600" } });
	} catch (e) {
		return new Response(`Waveform failed: ${e instanceof Error ? e.message : e}`, { status: 500 });
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}
