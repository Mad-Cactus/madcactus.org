import { describe, expect, test } from "bun:test";
import { isBotUA } from "./bot-ua";

// denylist gates both /l/ click counting and the video open beacon
describe("isBotUA", () => {
	test("human browsers pass", () => {
		expect(isBotUA("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36")).toBe(false);
		expect(isBotUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")).toBe(false);
		expect(isBotUA("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0")).toBe(false);
	});

	test("crawlers and prefetchers are denied", () => {
		for (const ua of [
			"LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
			"Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
			"Twitterbot/1.0",
			"facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
			"Mozilla/5.0 (compatible; CensysInspect/1.1; +https://about.censys.io)",
			"Mozilla/5.0 (compatible; NetcraftSurveyAgent/1.0; +info@netcraft.com)",
			"curl/8.7.1",
			"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/128.0.0.0 Safari/537.36",
			"Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)",
			"Python-requests/2.31.0",
		])
			expect(isBotUA(ua)).toBe(true);
	});

	test("missing UA counts as bot", () => {
		expect(isBotUA(null)).toBe(true);
		expect(isBotUA("")).toBe(true);
	});
});
