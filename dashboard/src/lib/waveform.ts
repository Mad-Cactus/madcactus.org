import { query } from "@solidjs/router";
import { getCurrentUser } from "./session";
import { supabaseService } from "~/lib/supabase";

const BUCKET_COUNT = 2400; // ~1.5s per bucket for a 1h meeting
const SAMPLE_RATE = 8000;

export interface Waveform {
	peaks: number[];
	durationMs: number;
}

/** Server query for the editor page — same data as the /api/waveform route,
 *  but callable during SSR (cookies ride along; no HTTP hop).
 *  Returns null when unauthorized or audio missing. */
export const getWaveformQuery = query(async (path: string) => {
	"use server";
	const user = await getCurrentUser();
	if (!user) return null;
	return computeWaveform(path);
}, "waveform");

/** Waveform peaks for the meeting editor's scrub bar. Cached in storage
 *  next to the audio as `<path>.peaks.json` — computed once per file.
 *  Returns null when the audio doesn't exist. Shared by the /api/waveform
 *  route and the getWaveformQuery server query (a relative fetch() to the
 *  route throws ERR_INVALID_URL during SSR, so the page uses the query). */
export async function computeWaveform(path: string): Promise<Waveform | null> {
	const svc = supabaseService();

	// cache hit?
	const cachePath = `${path}.peaks.json`;
	const { data: cached } = await svc.storage.from("portal-docs").download(cachePath);
	if (cached) return JSON.parse(await cached.text()) as Waveform;

	// pull audio, decode to mono s16le PCM via ffmpeg
	const { data: blob, error: dlErr } = await svc.storage.from("portal-docs").download(path);
	if (dlErr || !blob) return null;

	const dir = `${process.env.TMPDIR ?? "/tmp"}/mc-wave-${Date.now()}-${crypto.randomUUID()}`;
	try {
		const inPath = `${dir}/in.audio`;
		const pcmPath = `${dir}/pcm.raw`;
		await Bun.write(inPath, blob);

		// pcmPath is written directly by ffmpeg (stdout redirection via -y)
		const proc = Bun.spawn({
			cmd: ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", inPath, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "-acodec", "pcm_s16le", "-y", pcmPath],
			stdout: "ignore",
			stderr: "pipe",
			timeout: 300_000,
		});
		const code = await proc.exited;
		if (code !== 0) throw new Error(`ffmpeg exit ${code}: ${(await new Response(proc.stderr).text()).slice(0, 300)}`);

		const pcm = await Bun.file(pcmPath).bytes(); // s16le → read via DataView
		const view = new DataView(pcm.buffer);
		const samples = Math.floor(pcm.length / 2); // int16 LE
		const per = Math.max(1, Math.floor(samples / BUCKET_COUNT));
		const peaks = new Array<number>(BUCKET_COUNT * 2);
		for (let b = 0; b < BUCKET_COUNT; b++) {
			let min = 1;
			let max = -1;
			for (let i = 0; i < per; i++) {
				const off = (b * per + i) * 2;
				if (off + 1 >= pcm.length) break;
				const v = view.getInt16(off, true) / 32768;
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
		return body;
	} finally {
		await Bun.$`rm -rf ${dir}`.nothrow().quiet();
	}
}
