-- Replace pgvector embeddings with Postgres full-text search.
-- No API calls, no truncation, no pgvector dependency for search.

-- GIN index on a tsvector expression (no generated column needed)
create index if not exists idx_documents_fts
    on documents using gin (
        to_tsvector('english',
            coalesce(title, '') || ' ' ||
            coalesce(description, '') || ' ' ||
            coalesce(content, '')
        )
    );

-- Drop the old vector match function
drop function if exists match_documents(vector(1536), uuid, int);

-- FTS search function (replaces match_documents)
create or replace function search_documents_fts(
    filter_project_id uuid,
    search_text text,
    match_count int default 10
)
returns table (
    id uuid,
    title text,
    type text,
    url text,
    file_name text,
    description text,
    snippet text,
    rank real,
    created_at timestamptz
)
language sql stable as $$
    select
        d.id,
        d.title,
        d.type,
        d.url,
        d.file_name,
        d.description,
        case
            when d.content is not null then
                ts_headline('english', d.content,
                    websearch_to_tsquery('english', search_text),
                    'MaxFragments=1, MinWords=5, MaxWords=30')
            else null
        end as snippet,
        ts_rank(
            to_tsvector('english',
                coalesce(d.title, '') || ' ' ||
                coalesce(d.description, '') || ' ' ||
                coalesce(d.content, '')
            ),
            websearch_to_tsquery('english', search_text)
        )::real as rank,
        d.created_at
    from documents d
    where d.project_id = filter_project_id
      and d.visibility = 'client'
      and to_tsvector('english',
            coalesce(d.title, '') || ' ' ||
            coalesce(d.description, '') || ' ' ||
            coalesce(d.content, '')
          ) @@ websearch_to_tsquery('english', search_text)
    order by rank desc
    limit match_count;
$$;
