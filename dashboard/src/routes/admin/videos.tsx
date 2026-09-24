import { Title } from "@solidjs/meta";
import { createAsync, useAction } from "@solidjs/router";
import { For, Show, Suspense, createSignal } from "solid-js";
import Layout from "~/components/Layout";
import { getUserQuery } from "~/lib/queries";
import { getOutreachQuery, setOutreachVideoAction } from "~/lib/admin-queries";
import { stageLabel } from "~/db/schema";
import { videoSummary } from "~/lib/video-summary";

// Mirrors the server's free-plan cap (dashboard/src/routes/api/upload-video.ts).
const MAX_BYTES = 50 * 1024 * 1024;

// ponytail: the ~31MB ffmpeg.wasm core loads from unpkg (pinned), cached by the
// browser after first use. If the CDN/wasm load or encode fails we fall back to
// the raw upload — the server's 413 message names scripts/compress-video.sh.
let ffmpegP: Promise<import("@ffmpeg/ffmpeg").FFmpeg> | null = null;

function getFFmpeg() {
	return (ffmpegP ??= (async () => {
		const { FFmpeg } = await import("@ffmpeg/ffmpeg");
		const ff = new FFmpeg();
		const base = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
		// Blob URLs dodge the cross-origin classic-worker restriction.
		const blobURL = async (url: string, type: string) =>
			URL.createObjectURL(new Blob([await (await fetch(url)).blob()], { type }));
		await ff.load({
			coreURL: await blobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
			wasmURL: await blobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
		});
		return ff;
	})());
}

/** H.264 mp4, ≤1080p, faststart — same encode as scripts/compress-video.sh.
 *  Returns null when still ≥49MB after the crf-32 retry. */
async function compressTo50MB(file: File, onProgress: (pct: number) => void): Promise<File | null> {
	const ff = await getFFmpeg();
	const inName = `in.${file.name.match(/\.(mp4|mov|webm)$/i)?.[1] ?? "mp4"}`;
	await ff.writeFile(inName, new Uint8Array(await file.arrayBuffer()));
	const on = (off: "on" | "off") => ff[off]("progress", ({ progress }) => onProgress(Math.min(Math.round(progress * 100), 99)));
	on("on");
	try {
		for (const crf of [28, 32]) {
			const code = await ff.exec([
				"-i", inName,
				"-vf", "scale='min(1920,iw)':-2",
				"-c:v", "libx264", "-preset", "ultrafast", "-crf", String(crf),
				"-c:a", "aac", "-b:a", "96k",
				"-movflags", "+faststart",
				"out.mp4",
			]);
			if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
			const out = (await ff.readFile("out.mp4")) as Uint8Array;
			if (out.length < 49 * 1024 * 1024) {
				// TS: readFile's buffer is ArrayBufferLike; Blob wants ArrayBuffer.
				return new File([out.buffer as ArrayBuffer], file.name.replace(/\.[^.]+$/, "") + ".mp4", { type: "video/mp4" });
			}
		}
		return null;
	} finally {
		on("off");
		ff.deleteFile(inName).catch(() => {});
	}
}

export default function AdminVideos() {
	const user = createAsync(() => getUserQuery(), { deferStream: true });
	const outreach = createAsync(() => getOutreachQuery(), { deferStream: true });
	const saveVideo = useAction(setOutreachVideoAction);
	const [error, setError] = createSignal("");
	const [message, setMessage] = createSignal("");

	const vids = () => (outreach()?.all ?? []).filter((p) => p.videoUrl);

	async function handleLink(e: Event) {
		e.preventDefault();
		setError("");
		setMessage("");
		const form = e.target as HTMLFormElement;
		const file = (form.elements.namedItem("video_file") as HTMLInputElement).files?.[0];
		if (file) {
			let uploadFile = file;
			if (file.size > MAX_BYTES) {
				// Free plan rejects >50MB at upload — compress in the browser first.
				try {
					const out = await compressTo50MB(file, (pct) => setMessage(`Compressing ${pct}%…`));
					if (out) uploadFile = out;
					// out === null → too big even at crf 32; the server's 413 message
					// names the escape hatch.
				} catch {
					// wasm/CDN failure → try the raw upload anyway.
				}
			}
			// Stream the file to storage first; the action gets the public URL.
			setMessage(`Uploading ${uploadFile.name}…`);
			const up = await fetch(`/api/upload-video?name=${encodeURIComponent(uploadFile.name)}`, {
				method: "POST",
				headers: { "Content-Type": uploadFile.type || "video/mp4" },
				body: uploadFile,
			});
			const data = (await up.json().catch(() => ({}))) as { url?: string; error?: string };
			if (!up.ok || !data.url) {
				setError(data.error ?? "Upload failed.");
				setMessage("");
				return;
			}
			(form.elements.namedItem("video_url") as HTMLInputElement).value = data.url;
			setMessage("");
		}
		const fd = new FormData(form);
		fd.delete("video_file"); // action endpoint must not re-receive the big file
		const res = (await saveVideo(fd)) as { error?: string; success?: string };
		if (res.error) {
			setError(res.error);
			return;
		}
		setMessage(res.success ?? "Video saved.");
	}

	return (
		<Layout user={user()}>
			<Title>Videos — Mad Cactus</Title>
			<h1 class="page-title">Outreach Videos</h1>
			<p class="page-subtitle">
				Videos linked to prospects. Copy the email link for sends (tracked); use test to preview without polluting metrics.
			</p>

			<details style={{ "margin-bottom": "24px" }}>
				<summary style={{ cursor: "pointer", "font-weight": "600" }}>Link a video to a prospect</summary>
				<form onSubmit={handleLink} style={{ display: "grid", gap: "8px", "max-width": "640px", "margin-top": "12px" }}>
					<select name="id" required>
						<For each={outreach()?.all ?? []}>
							{(p) => (
								<option value={p.id}>
									{p.company}
									{p.videoUrl ? " (replaces current)" : ""}
								</option>
							)}
						</For>
					</select>
					<input type="file" name="video_file" accept="video/mp4,video/quicktime,video/webm" />
					<input type="url" name="video_url" placeholder="Video URL — cap.so link, mp4 URL, or pick a file above" spellcheck={false} />
					<input type="text" name="video_description" placeholder="Description — what it shows / why it exists" />
					<button type="submit" class="btn btn-primary">Save video</button>
				</form>
			</details>
			<Show when={error()}>
				<p class="login-error">{error()}</p>
			</Show>
			<Show when={message()}>
				<p class="muted">{message()}</p>
			</Show>

			<Suspense fallback={<p class="muted">Loading…</p>}>
				<Show
					when={vids().length}
					fallback={<p class="muted">No videos linked yet — link one above or set a Video URL on a prospect's card.</p>}
				>
					<div style={{ display: "grid", gap: "16px", "max-width": "640px" }}>
						<For each={vids()}>
							{(p) => (
								<div class="board-card">
									<div style={{ display: "flex", "align-items": "baseline", gap: "6px" }}>
										<span style={{ "font-weight": "600", "font-size": "13px" }}>{p.company}</span>
										<span class="badge" style={{ color: "var(--text-subtle)", "margin-left": "auto" }}>{stageLabel(p.stage)}</span>
									</div>
									<Show when={p.videoDescription}>
										<p class="muted" style={{ "font-size": "12px", margin: "4px 0" }}>{p.videoDescription}</p>
									</Show>
									<div style={{ "font-size": "12px", margin: "5px 0" }}>
										<a href={p.videoUrl!} target="_blank" rel="noreferrer">video ↗</a>{" "}
										<button
											type="button"
											class="btn btn-sm"
											onClick={() => navigator.clipboard.writeText(`${location.origin}/v/${p.id}`)}
										>
											copy email link
										</button>{" "}
										<a href={`/v/${p.id}?test=1`} target="_blank" rel="noreferrer">test ↗</a>
									</div>
									<Show
										when={videoSummary(p)}
										fallback={<div class="muted" style={{ "font-size": "12px" }}>not opened yet</div>}
									>
										<div style={{ color: "var(--orange)", "font-size": "12px" }}>{videoSummary(p)}</div>
									</Show>
								</div>
							)}
						</For>
					</div>
				</Show>
			</Suspense>
		</Layout>
	);
}
