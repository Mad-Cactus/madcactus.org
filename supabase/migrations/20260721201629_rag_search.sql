-- ── RAG Search: pgvector + embeddings ──────────────────────────────

-- Enable pgvector
create extension if not exists vector;

-- Add content + embedding columns to documents
alter table documents
    add column if not exists content text,
    add column if not exists embedding vector(1536);

-- Index for vector similarity search (ivfflat for cosine distance)
create index if not exists idx_documents_embedding
    on documents using ivfflat (embedding vector_cosine_ops)
    with (lists = 100);

-- ── Match function: semantic search over a project's documents ────
-- Called via supabase.rpc('match_documents', { query_embedding, project_id, limit })
-- Returns documents ordered by similarity, only for the given project + client-visible.
create or replace function match_documents(
    query_embedding vector(1536),
    filter_project_id uuid,
    match_count int default 10
)
returns table (
    id uuid,
    title text,
    type text,
    url text,
    file_name text,
    description text,
    content text,
    visibility text,
    created_at timestamptz,
    similarity float
)
language sql stable as $$
    select
        d.id,
        d.title,
        d.type,
        d.url,
        d.file_name,
        d.description,
        d.content,
        d.visibility,
        d.created_at,
        1 - (d.embedding <=> query_embedding) as similarity
    from documents d
    where d.embedding is not null
      and d.project_id = filter_project_id
      and d.visibility = 'client'
    order by d.embedding <=> query_embedding
    limit match_count;
$$;
