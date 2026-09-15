import { describe, expect, test } from "bun:test";
import { videoSummary } from "./video-summary";

const base = {
	videoViewCount: 0,
	videoFirstViewedAt: null as Date | null,
	videoCompleted: false,
	videoDurationSeconds: null as number | null,
	videoMaxPosition: 0,
	videoWatchSeconds: 0,
	videoLastViewedAt: null as Date | null,
};

describe("videoSummary", () => {
	test("null while untouched", () => {
		expect(videoSummary(base)).toBeNull();
	});

	test("opened but never played (scanner / click-away) — incl. legacy phantom count", () => {
		const t = new Date("2026-09-14T13:56:00Z");
		expect(videoSummary({ ...base, videoViewCount: 1, videoFirstViewedAt: t })).toContain("opened");
		expect(videoSummary({ ...base, videoFirstViewedAt: t })).toContain("not played");
	});

	test("real view shows count, percent, played time", () => {
		const s = videoSummary({
			...base,
			videoViewCount: 2,
			videoFirstViewedAt: new Date(),
			videoLastViewedAt: new Date(),
			videoDurationSeconds: 300,
			videoMaxPosition: 234,
			videoWatchSeconds: 221,
		})!;
		expect(s).toContain("viewed 2x");
		expect(s).toContain("78%");
		expect(s).toContain("3m 41s played");
	});

	test("finished beats percent", () => {
		const s = videoSummary({
			...base,
			videoViewCount: 1,
			videoFirstViewedAt: new Date(),
			videoLastViewedAt: new Date(),
			videoDurationSeconds: 300,
			videoMaxPosition: 300,
			videoCompleted: true,
		})!;
		expect(s).toContain("finished");
		expect(s).not.toContain("%");
	});
});
