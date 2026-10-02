// Assert-based tests for the AI-signal stage (bun test src/lib/ai-signal.test.ts).
// Fixtures from the study: BCW (Director of Ecommerce, headline self-labels AI —
// the pass case), Finemark (vendor with finemark.ai outbound — vendor-hint, not
// a fail), Koola (zero signal — fail), Wix (--wbu-color-ai-0 CSS trap).
import { test } from "bun:test";
import assert from "node:assert/strict";
import { AI_TOKEN, AI_PHRASES, aiHit, scoreRoster, scanSite, scoreAiSignal, brandTokens, type AiMatch } from "./ai-signal";
import { prospeoCompanyRoster, _resetThrottle, type ProspeoPerson } from "./enrich-prospeo";

const person = (over: Partial<ProspeoPerson>): ProspeoPerson => ({
	name: "Brett Mathews",
	title: "Director of Ecommerce",
	headline: null,
	historyTitles: [],
	...over,
});

test("AI token is case-sensitive: AIR, said, Kai never match", () => {
	assert.equal(AI_TOKEN.test("AIR freight"), false);
	assert.equal(AI_TOKEN.test("He said"), false);
	assert.equal(AI_TOKEN.test("Kai"), false);
	assert.equal(aiHit("kai airport said"), false);
});

test("BCW-style headline 'AI & SEO Digital Optimization' matches", () => {
	assert.equal(aiHit("AI & SEO Digital Optimization"), true);
});

test("phrase terms match case-insensitively", () => {
	for (const t of ["we use Artificial Intelligence", "Machine Learning ops", "Try ChatGPT", "GitHub Copilot", "our GenAI stack", "gen ai tools", "AI-powered dispatch", "ai driven routing", "AI-enabled billing"])
		assert.equal(aiHit(t), true, t);
});

test("Wix CSS var trap: --wbu-color-ai-0 is not a hit after style-strip", () => {
	const html = `<html><head><style>:root{--wbu-color-ai-0:#123456}</style></head><body><p>We move freight.</p></body></html>`;
	const scan = scanSite(html, "https://example.com/", "Example Freight");
	assert.deepEqual(scan.evidence, []);
	const scanWithStyleLeak = scanSite(html.replace("<p>We move freight.</p>", "<p>We move freight</p>"), "https://example.com/", "Example Freight");
	assert.deepEqual(scanWithStyleLeak.evidence, []);
	// and the token regex alone can't fire on lowercase css
	assert.equal(AI_TOKEN.test("--wbu-color-ai-0"), false);
	assert.equal(AI_PHRASES.test("--wbu-color-ai-0"), false);
});

test("site-only evidence never passes (manual rescue note)", () => {
	const r = scoreAiSignal({
		employeeMatches: [],
		siteEvidence: ["ai", "machine learning"],
		vendorHints: [],
		rosterTotal: 12,
		rosterPeople: 12,
		siteAttempted: true,
	});
	assert.equal(r.verdict, "fail");
	assert.equal(r.aiInterest, null);
	assert.equal(r.note.startsWith("tier2|"), true);
});

test("privacy and widget evidence are weak: they corroborate nothing", () => {
	const r = scoreAiSignal({
		employeeMatches: [],
		siteEvidence: ["POLICY:ai", "widget:livechat"],
		vendorHints: [],
		rosterTotal: 8,
		rosterPeople: 8,
		siteAttempted: true,
	});
	assert.equal(r.verdict, "fail");
	// …and they cannot upgrade an employee match to high
	const r2 = scoreAiSignal({
		employeeMatches: [{ name: "Brett Mathews", title: "Director of Ecommerce", evidence: "Brett — Director (headline: AI & SEO)" }],
		siteEvidence: ["POLICY:ai", "widget:livechat"],
		vendorHints: [],
		rosterTotal: 8,
		rosterPeople: 8,
		siteAttempted: true,
	});
	assert.equal(r2.verdict, "pass");
	assert.equal(r2.aiInterest, "some");
	assert.equal(r2.tier, 2);
});

test("Finemark fixture: employee match + finemark.ai outbound → pass with vendor-hint in the note, not a fail", () => {
	// variant A: anchor text "Finemark AI" is strong copy → tier1/high, hint rides along
	const scan = scanSite(`<a href="https://finemark.ai/">Finemark AI</a>`, "https://finemarkgroup.com/", "FINEMARK INC");
	assert.deepEqual(scan.vendorHints, ["finemark.ai", "finemark ai (marketing)"]);
	assert.deepEqual(scan.evidence, ["ai"]);
	const privacy = scanSite("<p>We use artificial intelligence to match loads.</p>", "https://finemarkgroup.com/privacy", "FINEMARK INC");
	assert.deepEqual(privacy.evidence, ["POLICY:artificial intelligence"]);
	const matches = scoreRoster([person({ headline: "AI & SEO Digital Optimization" })]);
	assert.equal(matches.length, 1);
	const rA = scoreAiSignal({
		employeeMatches: matches,
		siteEvidence: [...scan.evidence, ...privacy.evidence],
		vendorHints: scan.vendorHints,
		rosterTotal: 3,
		rosterPeople: 3,
		siteAttempted: true,
	});
	assert.equal(rA.verdict, "pass");
	assert.equal(rA.tier, 1);
	assert.equal(rA.aiInterest, "high");
	assert.equal(rA.note.includes("vendor-hint: finemark.ai"), true);

	// variant B: .ai link with neutral anchor — only weak POLICY evidence →
	// still passes on the employee match, still carries the vendor-hint
	const scanB = scanSite(`<a href="https://finemark.ai/track">Track loads</a>`, "https://finemarkgroup.com/", "FINEMARK INC");
	assert.deepEqual(scanB.vendorHints, ["finemark.ai"]);
	assert.deepEqual(scanB.evidence, []);
	const rB = scoreAiSignal({
		employeeMatches: matches,
		siteEvidence: [...scanB.evidence, ...privacy.evidence],
		vendorHints: scanB.vendorHints,
		rosterTotal: 3,
		rosterPeople: 3,
		siteAttempted: true,
	});
	assert.equal(rB.verdict, "pass");
	assert.equal(rB.tier, 2);
	assert.equal(rB.aiInterest, "some");
	assert.equal(rB.note.includes("vendor-hint: finemark.ai"), true);
	assert.equal(rB.note.startsWith("tier2|"), true);
});

test("directory vendor embeds (glydr.ai) are ignored, not vendor-hints", () => {
	const scan = scanSite(`<a href="https://glydr.ai/">Powered by Glydr</a>`, "https://bluestone transport.com/".replace(/ /g, ""), "BLUESTONE TRANSPORT");
	assert.deepEqual(scan.vendorHints, []);
	assert.deepEqual(scan.evidence, []);
});

test("BCW fixture: employee match, no site evidence → pass, tier2, some, no vendor-hint", () => {
	const matches = scoreRoster([
		person({ headline: "AI & SEO Digital Optimization" }),
		person({ name: "Offshore Dev", title: "Developer", headline: "full-stack dev" }),
	]);
	const r = scoreAiSignal({
		employeeMatches: matches,
		siteEvidence: [],
		vendorHints: [],
		rosterTotal: 9,
		rosterPeople: 9,
		siteAttempted: true,
	});
	assert.equal(r.verdict, "pass");
	assert.equal(r.aiInterest, "some");
	assert.equal(r.note.includes("vendor-hint"), false);
	assert.equal(r.note.includes("Brett Mathews — Director of Ecommerce (headline: AI & SEO Digital Optimization)"), true);
});

test("employee + strong site → tier1, high", () => {
	const r = scoreAiSignal({
		employeeMatches: [{ name: "B", title: "Ops", evidence: "B — Ops (headline: AI-powered dispatch)" }],
		siteEvidence: ["ai-powered", "widget:livechat"],
		vendorHints: [],
		rosterTotal: 4,
		rosterPeople: 4,
		siteAttempted: true,
	});
	assert.equal(r.tier, 1);
	assert.equal(r.aiInterest, "high");
});

test("Koola fixture: visible, zero signal → tier3 fail; invisible → tier4 fail", () => {
	const t3 = scoreAiSignal({ employeeMatches: [], siteEvidence: [], vendorHints: [], rosterTotal: 6, rosterPeople: 6, siteAttempted: true });
	assert.equal(t3.verdict, "fail");
	assert.equal(t3.note.startsWith("tier3|"), true);
	const t4 = scoreAiSignal({ employeeMatches: [], siteEvidence: [], vendorHints: [], rosterTotal: 0, rosterPeople: 0, siteAttempted: false });
	assert.equal(t4.verdict, "fail");
	assert.equal(t4.note.startsWith("tier4|"), true);
});

test("roster >25 flags pagination in the note", () => {
	const r = scoreAiSignal({ employeeMatches: [], siteEvidence: [], vendorHints: [], rosterTotal: 60, rosterPeople: 25, siteAttempted: true });
	assert.equal(r.note.includes("roster: 60>25"), true);
});

test("notes stay ≤300 chars even with a fat evidence list", () => {
	const r = scoreAiSignal({
		employeeMatches: Array.from({ length: 3 }, (_, i) => ({ name: `Person ${i} With A Long Name`, title: "Senior Vice President of Operations and Logistics".repeat(2), evidence: `Person ${i} — ${"very long evidence ".repeat(20)}` })),
		siteEvidence: ["ai", "machine learning", "artificial intelligence", "chatgpt", "copilot"],
		vendorHints: ["vendor.ai", "brand ai (marketing)", "our AI platform"],
		rosterTotal: 30,
		rosterPeople: 25,
		siteAttempted: true,
	});
	assert.equal(r.note.length <= 300, true, `note was ${r.note.length}`);
});

test("brandTokens drop generic freight words", () => {
	assert.deepEqual(brandTokens("FINEMARK INC"), ["finemark"]);
	assert.deepEqual(brandTokens("Alpha Logistics LLC"), ["alpha"]);
});

test("roster fetch: NO_RESULTS → empty roster; results map person fields", async () => {
	process.env.PROSPEO_API_KEY ??= "test-key";
	const realFetch = globalThis.fetch;
	try {
		_resetThrottle();
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ error: true, error_code: "NO_RESULTS" }), { status: 400 })) as unknown as typeof fetch;
		assert.deepEqual(await prospeoCompanyRoster({ name: "KOOLA" }), { people: [], total: 0 });

		_resetThrottle();
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					error: false,
					results: [
						{
							person: {
								full_name: "Eoghan Mccabe",
								current_job_title: "Director of Ecommerce",
								headline: "AI & SEO at BCW",
								job_history: [
									{ title: "Director of Ecommerce", current: true },
									{ title: "SEO Manager", current: false },
									{ title: "SEO Analyst", current: false },
									{ title: "SEO Manager", current: false },
								],
							},
						},
					],
					pagination: { total_count: 271 },
				}),
				{ status: 200 },
			)) as unknown as typeof fetch;
		const roster = await prospeoCompanyRoster({ companyId: "cccc7c7da6116a8830a07100", domain: "bcw.com", name: "BCW" });
		assert.equal(roster.total, 271);
		assert.deepEqual(roster.people, [
			{ name: "Eoghan Mccabe", title: "Director of Ecommerce", headline: "AI & SEO at BCW", historyTitles: ["SEO Manager", "SEO Analyst"] },
		]);
	} finally {
		globalThis.fetch = realFetch;
	}
});
