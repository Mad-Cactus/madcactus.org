import type { OutreachProspect } from "~/db/schema";

/** 272 → "4m 32s" */
export function fmtDate(d: Date | null): string {
	if (!d) return "—";
	return new Date(d).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

/** 272 → "4m 32s" */
export function fmtDur(secs: number | null): string {
	if (!secs) return "";
	const m = Math.floor(secs / 60);
	const s = secs % 60;
	return m ? `${m}m ${s}s` : `${s}s`;
}

/** "viewed 2x · 78% · 3m 41s played · last …" — null while untouched,
 *  "opened …" while a link was opened but the video never played. */
export function videoSummary(
	p: Pick<
		OutreachProspect,
		"videoViewCount" | "videoFirstViewedAt" | "videoCompleted" | "videoDurationSeconds" | "videoMaxPosition" | "videoWatchSeconds" | "videoLastViewedAt"
	>,
): string | null {
	// playback evidence, not the open count, decides "viewed" — legacy rows
	// (and scanners) can hold count > 0 with zero real playback
	const played = p.videoWatchSeconds > 0 || p.videoCompleted || p.videoMaxPosition > 0;
	if (!played) {
		if (!p.videoFirstViewedAt) return null;
		// open beacon fired but no playback: scanner / click-away / video never loaded
		return `opened ${fmtDate(p.videoFirstViewedAt)} · not played`;
	}
	const parts = [`viewed ${p.videoViewCount}x`];
	if (p.videoCompleted) parts.push("finished");
	else if (p.videoDurationSeconds) {
		// 0% is shown on purpose: opened, never played — an honest signal, not a bug
		const pct = Math.min(100, Math.round((p.videoMaxPosition / p.videoDurationSeconds) * 100));
		parts.push(`${pct}%`);
	}
	if (p.videoWatchSeconds > 0) parts.push(`${fmtDur(p.videoWatchSeconds)} played`);
	parts.push(`last ${fmtDate(p.videoLastViewedAt)}`);
	return parts.join(" · ");
}
