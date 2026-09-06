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

/** "viewed 2x · 78% · 3m 41s played · last …" — null while unopened. */
export function videoSummary(
	p: Pick<
		OutreachProspect,
		"videoViewCount" | "videoCompleted" | "videoDurationSeconds" | "videoMaxPosition" | "videoWatchSeconds" | "videoLastViewedAt"
	>,
): string | null {
	if (p.videoViewCount === 0) return null;
	const parts = [`viewed ${p.videoViewCount}x`];
	if (p.videoCompleted) parts.push("finished");
	else if (p.videoDurationSeconds) {
		const pct = Math.min(100, Math.round((p.videoMaxPosition / p.videoDurationSeconds) * 100));
		if (pct > 0) parts.push(`${pct}%`);
	}
	if (p.videoWatchSeconds > 0) parts.push(`${fmtDur(p.videoWatchSeconds)} played`);
	parts.push(`last ${fmtDate(p.videoLastViewedAt)}`);
	return parts.join(" · ");
}
