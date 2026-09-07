import { describe, expect, test } from "bun:test";
import { externalOrigin } from "./social";

// Behind Fly/Cloudflare TLS termination url.origin is http:// — the OAuth
// redirect_uri must be the https origin the browser (and LinkedIn's app
// registration) actually sees.
const req = (headers: Record<string, string> = {}, url = "http://madcactus.org/api/social/linkedin?start=1") =>
	new Request(url, { headers });

describe("externalOrigin", () => {
	test("prefers x-forwarded-proto/host (prod TLS-terminated)", () => {
		expect(externalOrigin(req({ "x-forwarded-proto": "https", host: "madcactus.org" }))).toBe(
			"https://madcactus.org",
		);
	});

	test("takes first proto when chained", () => {
		expect(externalOrigin(req({ "x-forwarded-proto": "https, http", host: "x.test" }))).toBe("https://x.test");
	});

	test("falls back to request URL (local dev, no proxy)", () => {
		expect(externalOrigin(req({}, "http://localhost:3000/x"))).toBe("http://localhost:3000");
	});
});
