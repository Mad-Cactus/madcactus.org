// Component registry + entity_links lib — pure-layer tests (no db: the test
// env points DATABASE_URL at a dummy host; these cover the pieces that must
// work without touching postgres).
import { test, expect } from "bun:test";
import { COMPONENTS, listComponentTypes, getComponent } from "~/registry/registry";
import { parseMentions, linkComponents, MENTION_RE, UnknownKindError } from "~/lib/entity-links";
import { videoSummary } from "~/lib/video-summary";

test("every registered component carries the teaching contract", () => {
	for (const def of Object.values(COMPONENTS)) {
		expect(def.kind.length).toBeGreaterThan(0);
		expect(def.label.length).toBeGreaterThan(0);
		// descriptions teach agents what each component IS — the discovery tool
		// (list_component_types) is only as good as these strings
		expect(def.description.length).toBeGreaterThan(20);
		// every component is either table-backed (generic load) or has a loader
		expect(def.table ?? def.load).toBeDefined();
	}
});

test("the pilot kinds are registered with the right vocabulary", () => {
	expect(COMPONENTS["video"]).toBeDefined();
	expect(COMPONENTS["video"].ownerLinks?.[0]?.kind).toBe("prospect");
	expect(COMPONENTS["prospect"].status?.labels?.watching).toBeDefined();
	expect(COMPONENTS["meeting"].table).toBeDefined();
	// meeting = documents view: same table, narrower (transcript-only)
	expect(COMPONENTS["meeting"].where).toBeDefined();
	expect(COMPONENTS["doc"].publicPath).toBeDefined();
});

test("listComponentTypes returns the map of the business", () => {
	const types = listComponentTypes();
	expect(types.length).toBe(Object.keys(COMPONENTS).length);
	for (const t of types) {
		expect(t.kind).toBeDefined();
		expect(t.description.length).toBeGreaterThan(20);
	}
	expect(types.map((t) => t.kind)).toContain("video");
});

test("getComponent: known + unknown kinds", () => {
	expect(getComponent("video")?.kind).toBe("video");
	expect(getComponent("quantum-brain")).toBeUndefined();
});

test("parseMentions: dedupes, skips unknown kinds, accepts slugs and uuids", () => {
	const uuid = "3fb8c1a2-9c4d-4a1b-b2e3-111122223333";
	const md = `see @[video:${uuid}] again @[video:${uuid}] and @[short-link:abc1234] but @[quantum:thing] stays out`;
	const refs = parseMentions(md);
	expect(refs).toEqual([
		{ kind: "video", id: uuid },
		{ kind: "short-link", id: "abc1234" },
	]);
});

test("parseMentions: empty and mention-free bodies", () => {
	expect(parseMentions("")).toEqual([]);
	expect(parseMentions("plain text, no refs")).toEqual([]);
	expect(parseMentions("email me @collin here")).toEqual([]);
});

test("MENTION_RE matches the @[kind:id] syntax only", () => {
	expect(MENTION_RE.test("@[video:abc-123]")).toBe(true);
	expect("@x [y](z) @[a:b]".match(MENTION_RE)?.[0]).toBe("@[a:b]");
	expect(MENTION_RE.test("@notamention")).toBe(false);
});

test("linkComponents rejects unknown kinds BEFORE any db access", async () => {
	await expect(linkComponents({ kind: "doc", id: "x" }, { kind: "quantum", id: "y" })).rejects.toBeInstanceOf(
		UnknownKindError,
	);
	await expect(linkComponents({ kind: "quantum", id: "x" }, { kind: "doc", id: "y" })).rejects.toBeInstanceOf(
		UnknownKindError,
	);
});

test("videoSummary works over the videos-row shape (post-promotion)", () => {
	expect(videoSummary({ viewCount: 0, firstViewedAt: null, completed: false, durationSeconds: null, maxPosition: 0, watchSeconds: 0, lastViewedAt: null })).toBeNull();
});
