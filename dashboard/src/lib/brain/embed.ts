// Embeddings — the semantic layer. Columns (brain_chunks.embedding,
// brain_facts.embedding) live in migration 0017, Supabase-only: this module
// degrades to a no-op without an embeddings key or without pgvector (local dev),
// and search falls back to pure FTS. Backfill is content-hash based — rechunk
// or edit a text and it re-embeds on the next cycle.
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "~/db";

export function textHash(text: string): string {
	return createHash("md5").update(text).digest("hex");
}

async function embedBatch(texts: string[]): Promise<number[][]> {
	// one key for everything: OpenRouter serves both chat (BRAIN_MODEL) and
	// embeddings. Override with EMBEDDINGS_* envs to use OpenAI (or any
	// OpenAI-compatible endpoint) directly.
	const key = process.env.EMBEDDINGS_API_KEY || process.env.OPENROUTER_API_KEY;
	if (!key) throw new Error("EMBEDDINGS_API_KEY (or OPENROUTER_API_KEY) not set");
	const base = process.env.EMBEDDINGS_BASE_URL || "https://openrouter.ai/api/v1";
	const model = process.env.EMBEDDINGS_MODEL || "openai/text-embedding-3-large";
	const res = await fetch(`${base.replace(/\/$/, "")}/embeddings`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
		body: JSON.stringify({ model, input: texts }),
	});
	if (!res.ok) throw new Error(`embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);
	const body = (await res.json()) as { data?: { embedding: number[] }[] };
	if (!body.data) throw new Error("embeddings: empty response");
	return body.data.map((d) => d.embedding);
}

const toVec = (v: number[]) => `[${v.join(",")}]`;

/** Embed the query for semantic search, or null when unconfigured. */
export async function embedQuery(query: string): Promise<number[] | null> {
	if (!embeddingsEnabled()) return null;
	try {
		return (await embedBatch([query]))[0] ?? null;
	} catch {
		return null;
	}
}

export function embeddingsEnabled(): boolean {
	return !!(process.env.EMBEDDINGS_API_KEY || process.env.OPENROUTER_API_KEY);
}

/**
 * Embed chunks + facts whose stored md5 is stale or missing. Raw SQL — the
 * embedding columns live only on pgvector databases (migration 0017); local
 * dev DBs without pgvector return a graceful error instead of breaking cycles.
 */
export async function embedPending(opts: { batchSize?: number } = {}): Promise<Record<string, unknown>> {
	if (!embeddingsEnabled()) return { skipped: "no embeddings key set" };
	const batch = opts.batchSize ?? 32;
	try {
		const chunks = await db.execute<{ id: string; chunk_text: string }>(sql`
			SELECT id, chunk_text FROM brain_chunks
			WHERE embedding IS NULL OR embedded_text_hash IS DISTINCT FROM md5(chunk_text)
			LIMIT ${batch}
		`);
		if (chunks.length > 0) {
			const vectors = await embedBatch(chunks.map((c) => c.chunk_text));
			for (let i = 0; i < chunks.length; i++) {
				await db.execute(sql`
					UPDATE brain_chunks SET embedding = ${toVec(vectors[i])}::vector,
						embedded_at = now(), embedded_text_hash = ${textHash(chunks[i].chunk_text)}
					WHERE id = ${chunks[i].id}::uuid
				`);
			}
		}
		const facts = await db.execute<{ id: string; fact: string }>(sql`
			SELECT id, fact FROM brain_facts
			WHERE expired_at IS NULL AND (embedding IS NULL OR embedded_at IS NULL)
			LIMIT ${batch}
		`);
		if (facts.length > 0) {
			const vectors = await embedBatch(facts.map((f) => f.fact));
			for (let i = 0; i < facts.length; i++) {
				await db.execute(sql`
					UPDATE brain_facts SET embedding = ${toVec(vectors[i])}::vector, embedded_at = now()
					WHERE id = ${facts[i].id}::uuid
				`);
			}
		}
		return { chunks: chunks.length, facts: facts.length };
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
}
