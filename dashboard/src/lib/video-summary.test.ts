import { describe, expect, test } from "bun:test";
import { videoSummary } from "./video-summary";

const base = {
	viewCount: 0,
	firstViewedAt: null as Date | null,
	completed: false,
	durationSeconds: null as number | null,
	maxPosition: 0,
	watchSeconds: 0,
	lastViewedAt: null as Date | null,
};

describe("videoSummary", () => {
	test("null while untouched", () => {
		expect(videoSummary(base)).toBeNull();
	});

	test("opened but never played (scanner / click-away) — incl. legacy phantom count", () => {
		const t = new Date("2026-09-14T13:56:00Z");
		expect(videoSummary({ ...base, viewCount: 1, firstViewedAt: t })).toContain("opened");
		expect(videoSummary({ ...base, firstViewedAt: t })).toContain("not played");
	});

	test("real view shows count, percent, played time", () => {
		const s = videoSummary({
			...base,
			viewCount: 2,
			firstViewedAt: new Date(),
			lastViewedAt: new Date(),
			durationSeconds: 300,
			maxPosition: 234,
			watchSeconds: 221,
		})!;
		expect(s).toContain("viewed 2x");
		expect(s).toContain("78%");
		expect(s).toContain("3m 41s played");
	});

	test("finished beats percent", () => {
		const s = videoSummary({
			...base,
			viewCount: 1,
			firstViewedAt: new Date(),
			lastViewedAt: new Date(),
			durationSeconds: 300,
			maxPosition: 300,
			completed: true,
		})!;
		expect(s).toContain("finished");
		expect(s).not.toContain("%");
	});
});
