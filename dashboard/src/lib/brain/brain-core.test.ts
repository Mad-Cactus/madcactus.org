// Tests for brain core helpers (pure, no DB).
// Run: DATABASE_URL=postgres://dummy@localhost:5/dummy bun test src/lib
import { describe, expect, test } from "bun:test";
import {
	chunkText,
	computeEmotionalWeight,
	factHash,
	loopDedupKey,
	planLoopForThread,
	slugify,
	type ThreadSummary,
} from "./core";

describe("slugify", () => {
	test("kebab-cases names", () => {
		expect(slugify("Koola Logistics")).toBe("koola-logistics");
	});
	test("strips punctuation and trims", () => {
		expect(slugify("  Acme, Inc. — (west coast) ")).toBe("acme-inc-west-coast");
	});
	test("empty input falls back to untitled", () => {
		expect(slugify("---")).toBe("untitled");
	});
});

describe("factHash", () => {
	test("same fact, same hash regardless of whitespace/case", () => {
		expect(factHash("Ships every Tuesday")).toBe(factHash("  ships   every Tuesday "));
	});
	test("different facts hash differently", () => {
		expect(factHash("Ships every Tuesday")).not.toBe(factHash("Ships every Monday"));
	});
});

describe("loopDedupKey", () => {
	test("one key per detector+type+thread", () => {
		expect(loopDedupKey("deterministic_thread", "unanswered_inbound", "t1")).toBe(
			"deterministic_thread:unanswered_inbound:t1",
		);
	});
});

describe("chunkText", () => {
	test("splits on headings and packs paragraphs", () => {
		const md = "# A\n\n" + "para one\n\n" + "para two\n\n" + "## B\n\n" + "para three";
		const chunks = chunkText(md, 10_000);
		expect(chunks.length).toBe(2);
		expect(chunks[0]).toContain("# A");
		expect(chunks[1]).toContain("## B");
	});
	test("oversized paragraphs are hard-split", () => {
		const md = "x".repeat(5000);
		const chunks = chunkText(md, 1600);
		expect(chunks.length).toBe(4);
	});
	test("empty input yields no chunks", () => {
		expect(chunkText("   \n\n  ")).toEqual([]);
	});
});

describe("planLoopForThread", () => {
	const days = (n: number) => new Date(Date.now() - n * 86_400_000);
	const base: ThreadSummary = {
		id: "t1",
		subject: "Proposal follow-up",
		fromEmail: "client@example.com",
		companyId: null,
		lastMessageAt: days(5),
		lastMessageIsSent: false,
		hasOpenLoop: false,
		hasMyReply: true,
	};
	test("stale inbound opens a loop", () => {
		const plan = planLoopForThread(base, new Date(), 3);
		expect(plan.action).toBe("open");
		if (plan.action === "open") {
			expect(plan.loopType).toBe("unanswered_inbound");
			expect(plan.dedupKey).toContain("t1");
		}
	});
	test("recent inbound does not open a loop", () => {
		expect(planLoopForThread({ ...base, lastMessageAt: days(1) }, new Date(), 3).action).toBe("none");
	});
	test("already-open loop is not reopened", () => {
		expect(planLoopForThread({ ...base, hasOpenLoop: true }, new Date(), 3).action).toBe("none");
	});
	test("human replied → close the loop", () => {
		const plan = planLoopForThread({ ...base, lastMessageIsSent: true, hasOpenLoop: true }, new Date(), 3);
		expect(plan.action).toBe("close");
	});
	test("client replied after loop opened → close it", () => {
		// last message inbound but fresh: their reply arrived, loop no longer stale
		const plan = planLoopForThread({ ...base, hasOpenLoop: true, lastMessageAt: days(1) }, new Date(), 3);
		expect(plan.action).toBe("close");
	});
	test("newsletter I never replied to → no loop", () => {
		// two-way gate: no reply from me, sender not a known client
		const plan = planLoopForThread({ ...base, hasMyReply: false, companyId: null }, new Date(), 3);
		expect(plan.action).toBe("none");
	});
	test("role sender (noreply/newsletter) → never a loop, even from a client domain", () => {
		for (const addr of ["noreply@stripe.com", "newsletter@mobbin.com", "updates@resend.com"]) {
			const plan = planLoopForThread({ ...base, fromEmail: addr, companyId: "c1" }, new Date(), 3);
			expect(plan.action).toBe("none");
		}
	});
	test("known client's first-touch inbound still opens a loop", () => {
		const plan = planLoopForThread({ ...base, hasMyReply: false, companyId: "c1" }, new Date(), 3);
		expect(plan.action).toBe("open");
	});
	test("previously-opened noise loop fails the gate → closes itself", () => {
		const plan = planLoopForThread({ ...base, hasMyReply: false, companyId: null, hasOpenLoop: true }, new Date(), 3);
		expect(plan.action).toBe("close");
	});
});

describe("computeEmotionalWeight", () => {
	test("fresh page with loops + notable facts ranks higher than stale quiet one", () => {
		const now = new Date();
		const hot = computeEmotionalWeight({
			updatedAt: now,
			openLoops: 2,
			factNotability: { high: 3, medium: 2, low: 0 },
			now,
		});
		const cold = computeEmotionalWeight({
			updatedAt: new Date(now.getTime() - 60 * 86_400_000),
			openLoops: 0,
			factNotability: { high: 0, medium: 1, low: 0 },
			now,
		});
		expect(hot).toBeGreaterThan(cold);
		expect(hot).toBeLessThanOrEqual(1);
		expect(cold).toBeGreaterThanOrEqual(0);
	});
});

import { findPairs, type VersionRow } from "./distill";

const vr = (entityId: string, author: string, minsAgo: number, content = ""): VersionRow => ({
	id: `${entityId}-${author}-${minsAgo}`,
	entity: "doc",
	entityId,
	author,
	content,
	createdAt: new Date(Date.now() - minsAgo * 60_000),
});

describe("findPairs", () => {
	test("pairs each agent write with the next human edit", () => {
		const pairs = findPairs([vr("d1", "agent", 30), vr("d1", "human", 20), vr("d1", "agent", 10), vr("d1", "human", 5)]);
		expect(pairs.length).toBe(2);
		expect(pairs[0].agent.createdAt < pairs[0].human.createdAt).toBe(true);
		expect(pairs[1].agent.id).toContain("10");
	});
	test("trailing agent write without human edit pairs nothing", () => {
		expect(findPairs([vr("d1", "agent", 10)]).length).toBe(0);
	});
	test("consecutive human edits collapse into one pair against the last agent write", () => {
		const pairs = findPairs([vr("d1", "agent", 30), vr("d1", "human", 20), vr("d1", "human", 10)]);
		expect(pairs.length).toBe(1);
		expect(pairs[0].human.id).toContain("10");
	});
	test("entities are paired independently", () => {
		const pairs = findPairs([vr("d1", "agent", 30), vr("d2", "agent", 25), vr("d2", "human", 20), vr("d1", "human", 10)]);
		expect(pairs.length).toBe(2);
		expect(pairs.map((p) => p.entityId).sort()).toEqual(["d1", "d2"]);
	});
});
