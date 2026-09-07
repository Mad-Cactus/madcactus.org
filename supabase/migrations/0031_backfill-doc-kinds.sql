-- Backfill docs.kind for rows created before the docs/posts/newsletters split
-- (migration 0027 added the column with no backfill; DocList filters by kind,
-- so unclassified docs vanished from the Posts and Newsletters tabs).
-- Title-based classification: only unambiguous matches; everything else stays
-- a plain doc (kind NULL) and keeps showing on the Docs tab only.
UPDATE "docs" SET "kind" = 'post' WHERE "kind" IS NULL AND "title" ILIKE 'LinkedIn post%';
UPDATE "docs" SET "kind" = 'newsletter' WHERE "kind" IS NULL AND "title" ILIKE 'The Cactus Dispatch%';
