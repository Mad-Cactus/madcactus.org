-- pgvector semantic retrieval (Supabase-only: the extension ships there).
-- Columns are intentionally NOT in drizzle schema.ts — they're accessed via
-- raw SQL so local (non-pgvector) dev DBs don't drift. See lib/brain/embed.ts.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TABLE brain_chunks ADD COLUMN embedding vector(1536);--> statement-breakpoint
ALTER TABLE brain_chunks ADD COLUMN embedded_at timestamptz;--> statement-breakpoint
ALTER TABLE brain_chunks ADD COLUMN embedded_text_hash text;--> statement-breakpoint
ALTER TABLE brain_facts ADD COLUMN embedding vector(1536);--> statement-breakpoint
ALTER TABLE brain_facts ADD COLUMN embedded_at timestamptz;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_brain_chunks_embedding
  ON brain_chunks USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_brain_facts_embedding
  ON brain_facts USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL;
