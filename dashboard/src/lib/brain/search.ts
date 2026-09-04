// Brain search — the query path. Hybrid ranking: full-text (tsvector) over
// distilled pages/chunks + semantic (pgvector cosine) when embeddings are
// configured, facts by entity + text, open loops. Raw workspace records stay
// in workspace-search.ts.
import { sql, desc, eq, and, isNull } from "drizzle-orm";
import { db } from "~/db";
import { brainChunks, brainFacts, brainOpenLoops, brainPages } from "~/db/schema";
import { embedQuery } from "./embed";

const tsq = (q: string) => sql`websearch_to_tsquery('english', ${q})`;

export type BrainQueryResult = {
	pages: { slug: string; title: string; type: string; snippet: string; weight: number }[];
	chunks: { slug: string; title: string; snippet: string }[];
	facts: { entity_slug: string; fact: string; kind: string; notability: string; confidence: number }[];
	open_loops: { dedup_key: string; loop_type: string; summary: string; due_at: Date | null; status: string }[];
};

export async function brainQuery(query: string): Promise<BrainQueryResult> {
	const q = query.trim();
	if (!q) return { pages: [], chunks: [], facts: [], open_loops: [] };
	const like = `%${q}%`;

	// semantic path (pgvector, migration 0017): nearest chunks to the query
	// embedding, merged with the FTS hits. No key / no pgvector → empty, FTS covers it.
	let semantic: { slug: string; title: string; snippet: string }[] = [];
	const vec = await embedQuery(q);
	if (vec) {
		try {
			// raw SQL: the embedding columns exist only on pgvector DBs (migration 0017)
			semantic = await db.execute<{ slug: string; title: string; snippet: string }>(sql`
				SELECT p.slug, p.title, left(c.chunk_text, 400) AS snippet
				FROM brain_chunks c
				JOIN brain_pages p ON p.id = c.page_id
				WHERE p.deleted_at IS NULL AND c.embedding IS NOT NULL
				ORDER BY c.embedding <=> ${`[${vec.join(",")}]`}::vector
				LIMIT 6
			`);
		} catch {
			// local dev without pgvector
		}
	}

	const pages = await db
		.select({
			slug: brainPages.slug,
			title: brainPages.title,
			type: brainPages.type,
			weight: brainPages.emotionalWeight,
			snippet: sql<string>`left(${brainPages.compiledTruth}, 400)`,
		})
		.from(brainPages)
		.where(
			sql`(${brainPages.deletedAt} IS NULL) AND (to_tsvector('english', ${brainPages.title} || ' ' || ${brainPages.compiledTruth}) @@ ${tsq(q)}
				OR ${brainPages.title} ILIKE ${like})`,
		)
		.orderBy(desc(brainPages.emotionalWeight), desc(brainPages.updatedAt))
		.limit(8);

	const chunks = await db
		.select({
			slug: brainPages.slug,
			title: brainPages.title,
			snippet: sql<string>`left(${brainChunks.chunkText}, 400)`,
		})
		.from(brainChunks)
		.innerJoin(brainPages, eq(brainPages.id, brainChunks.pageId))
		.where(
			sql`(${brainPages.deletedAt} IS NULL) AND to_tsvector('english', ${brainChunks.chunkText}) @@ ${tsq(q)}`,
		)
		.limit(8);

	const facts = await db
		.select({
			entity_slug: brainFacts.entitySlug,
			fact: brainFacts.fact,
			kind: brainFacts.kind,
			notability: brainFacts.notability,
			confidence: brainFacts.confidence,
		})
		.from(brainFacts)
		.where(
			sql`${brainFacts.expiredAt} IS NULL AND to_tsvector('english', ${brainFacts.entitySlug} || ' ' || ${brainFacts.fact}) @@ ${tsq(q)}`,
		)
		.orderBy(desc(brainFacts.notability), desc(brainFacts.confidence))
		.limit(20);

	const loops = await db
		.select({
			dedup_key: brainOpenLoops.dedupKey,
			loop_type: brainOpenLoops.loopType,
			summary: brainOpenLoops.summary,
			due_at: brainOpenLoops.dueAt,
			status: brainOpenLoops.status,
		})
		.from(brainOpenLoops)
		.where(and(eq(brainOpenLoops.status, "open"), sql`${brainOpenLoops.summary} ILIKE ${like}`))
		.limit(10);

	return { pages, chunks: [...chunks, ...semantic], facts, open_loops: loops };
}

/** All live (non-expired, non-superseded) facts for one entity slug. */
export async function entityFacts(slug: string) {
	return db
		.select()
		.from(brainFacts)
		.where(
			and(
				eq(brainFacts.entitySlug, slug),
				isNull(brainFacts.expiredAt),
				isNull(brainFacts.consolidatedInto),
			),
		)
		.orderBy(desc(brainFacts.createdAt))
		.limit(200);
}
