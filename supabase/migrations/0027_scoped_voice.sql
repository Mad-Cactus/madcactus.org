-- Scoped voice learning: docs get a freeform genre (marketing, informational,
-- casual, …); voice patterns and lessons carry the (surface, genre) scope they
-- were learned in, so a LinkedIn-post edit never lints an email again.
-- null surface = global rule, null genre = applies to every genre on its surface.

ALTER TABLE "docs" ADD COLUMN "genre" text;
ALTER TABLE "voice_patterns" ADD COLUMN "surface" text;
ALTER TABLE "voice_patterns" ADD COLUMN "genre" text;
ALTER TABLE "brain_facts" ADD COLUMN "genre" text;
