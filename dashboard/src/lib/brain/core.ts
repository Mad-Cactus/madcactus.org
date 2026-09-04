// Brain core — pure helpers shared by ingest/distill/search. No DB, no IO:
// everything here is unit-testable (see brain-core.test.ts).

/** kebab-case citation slug, gbrain-style: [a-z0-9-] */
export function slugify(input: string): string {
	return (
		input
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 64) || "untitled"
	);
}

/** Deterministic fact dedup key — gbrain dedups on normalized text. */
export function factHash(fact: string): string {
	// md5 hex via Bun hashing would drift across runtimes; keep a tiny stable
	// normalize + djb2 — collisions only cost a skipped near-dupe insert.
	const norm = fact.toLowerCase().trim().replace(/\s+/g, " ");
	let h = 5381;
	for (let i = 0; i < norm.length; i++) h = ((h << 5) + h + norm.charCodeAt(i)) >>> 0;
	return h.toString(16).padStart(8, "0") + "-" + norm.length.toString(16);
}

/** Open-loop dedup: one loop per (detector, thread). */
export function loopDedupKey(detector: "deterministic_thread", loopType: string, threadId: string): string {
	return `${detector}:${loopType}:${threadId}`;
}

/**
 * Split markdown into retrieval chunks: split on headings, then pack
 * paragraphs to ~maxChars. Mirrors gbrain's paragraph packing without the
 * tokenizer dependency.
 */
export function chunkText(markdown: string, maxChars = 1600): string[] {
	if (!markdown.trim()) return [];
	const paragraphs = markdown.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
	const chunks: string[] = [];
	let cur = "";
	const push = () => {
		if (cur.trim()) chunks.push(cur.trim());
		cur = "";
	};
	for (const para of paragraphs) {
		// a heading always starts a new chunk (section boundary)
		if (/^#{1,4}\s/.test(para)) push();
		if ((cur + "\n\n" + para).length > maxChars && cur) push();
		// single oversized paragraph: hard-split
		if (para.length > maxChars) {
			for (let i = 0; i < para.length; i += maxChars) {
				if (cur) push();
				cur = para.slice(i, i + maxChars);
				push();
			}
		} else {
			cur = cur ? cur + "\n\n" + para : para;
		}
	}
	push();
	return chunks;
}

/** Deterministic open-loop detection plan from a thread summary row. */
export type ThreadSummary = {
	id: string;
	subject: string;
	fromEmail: string | null;
	companyId: string | null;
	lastMessageAt: Date;
	lastMessageIsSent: boolean;
	hasOpenLoop: boolean;
};

export type LoopAction =
	| { action: "open"; dedupKey: string; loopType: "unanswered_inbound"; summary: string; threadId: string; companyId: string | null; counterpartyEmail: string | null }
	| { action: "close"; dedupKey: string }
	| { action: "none" };

/** Inbound older than STALE_DAYS with no reply = unanswered loop; replied = close. */
export function planLoopForThread(t: ThreadSummary, now = new Date(), staleDays = 3): LoopAction {
	const dedupKey = loopDedupKey("deterministic_thread", "unanswered_inbound", t.id);
	const staleMs = now.getTime() - t.lastMessageAt.getTime();
	if (!t.lastMessageIsSent && staleMs > staleDays * 86_400_000) {
		if (t.hasOpenLoop) return { action: "none" };
		return {
			action: "open",
			dedupKey,
			loopType: "unanswered_inbound",
			summary: `No reply yet to "${t.subject}" from ${t.fromEmail ?? "unknown"}`,
			threadId: t.id,
			companyId: t.companyId,
			counterpartyEmail: t.fromEmail,
		};
	}
	if (t.hasOpenLoop && (t.lastMessageIsSent || staleMs <= staleDays * 86_400_000)) {
		return { action: "close", dedupKey };
	}
	return { action: "none" };
}

/** Salience: recency (half-life 14d) + loop pressure + notability of facts. */
export function computeEmotionalWeight(opts: {
	updatedAt: Date;
	openLoops: number;
	factNotability: { high: number; medium: number; low: number };
	now?: Date;
}): number {
	const now = opts.now ?? new Date();
	const days = Math.max(0, (now.getTime() - opts.updatedAt.getTime()) / 86_400_000);
	const recency = Math.pow(0.5, days / 14);
	const loopPressure = Math.min(1, opts.openLoops * 0.25);
	const notability =
		Math.min(1, opts.factNotability.high * 0.2 + opts.factNotability.medium * 0.05);
	return Math.min(1, 0.5 * recency + 0.3 * loopPressure + 0.2 * notability);
}
