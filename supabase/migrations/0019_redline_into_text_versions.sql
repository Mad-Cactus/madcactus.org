-- Fold the legacy redline corpus into the native diff-engine + brain tables,
-- then drop the redline tables. Idempotent: if redline_pairs is gone (already
-- migrated), the whole block is a no-op.
--
-- Mapping:
--   redline_pairs (draft/final)  → text_versions: one synthetic entity per
--                                  pair — v1 author=agent (draft), v2
--                                  author=human (final). findPairs/
--                                  extractLessons consume these exactly like
--                                  live doc edits. Historical timestamps in
--                                  the legacy rows are epoch garbage, so the
--                                  migrated versions are stamped at migration
--                                  time.
--   redline_lessons              → brain_facts: entity 'voice', kind 'lesson',
--                                  notability 'high', provenance
--                                  source_table=text_versions pointing at the
--                                  pair's human version; same djb2 fact_hash
--                                  the runtime uses so future re-derivations
--                                  dedup instead of duplicating.
--   extract_lessons/extract_facts cursors move to migration time: the migrated
--   corpus is already distilled (its lessons are inserted above), so the LLM
--   must not re-derive it.
--   redline_patterns             → dropped without a home: the dashboard has
--                                  no lint-pattern consumer (the send gate was
--                                  removed with redline). The 62 rules remain
--                                  in ~/backups/madcactus-redline-backup.json
--                                  and ~/.redline/emails.db.

DO $$
DECLARE
	v_now timestamptz := now();
BEGIN
	IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'redline_pairs') THEN
		RETURN;
	END IF;

	-- 1. pairs → text_versions (agent v1 / human v2, deterministic ids)
	INSERT INTO text_versions (id, entity, entity_id, version, author, content, created_at, updated_at)
	SELECT md5(p.id::text || '-agent')::uuid, 'doc', p.id, 1, 'agent', p.draft_content, v_now, v_now
	FROM redline_pairs p
	ON CONFLICT (entity, entity_id, version) DO NOTHING;

	INSERT INTO text_versions (id, entity, entity_id, version, author, content, created_at, updated_at)
	SELECT md5(p.id::text || '-human')::uuid, 'doc', p.id, 2, 'human', p.final_content, v_now + interval '1 second', v_now + interval '1 second'
	FROM redline_pairs p
	ON CONFLICT (entity, entity_id, version) DO NOTHING;

	-- 2. djb2 fact hash, byte-identical to src/lib/brain/core.ts factHash()
	CREATE OR REPLACE FUNCTION pg_temp.brain_fact_hash(fact text) RETURNS text AS $fn$
	DECLARE
		h bigint := 5381;
		i int;
		norm text;
	BEGIN
		norm := lower(trim(regexp_replace(fact, '\s+', ' ', 'g')));
		FOR i IN 1 .. length(norm) LOOP
			h := (h * 33 + ascii(substr(norm, i, 1))) % 4294967296;
		END LOOP;
		RETURN lpad(to_hex(h), 8, '0') || '-' || to_hex(length(norm));
	END;
	$fn$ LANGUAGE plpgsql;

	INSERT INTO brain_facts (entity_slug, fact, kind, notability, confidence, surface, source_table, source_id, fact_hash, created_at, valid_from)
	SELECT 'voice', l.lesson, 'lesson', 'high', 0.9,
		CASE p.surface WHEN 'doc' THEN 'docs' WHEN 'email' THEN 'email' ELSE NULL END,
		'text_versions', md5(p.id::text || '-human')::uuid,
		pg_temp.brain_fact_hash(l.lesson), v_now, v_now
	FROM redline_lessons l
	JOIN redline_pairs p ON p.id = l.pair_id
	ON CONFLICT (entity_slug, fact_hash) DO NOTHING;

	-- 3. cursors past the migrated corpus — it ships pre-distilled
	INSERT INTO brain_state (key, value) VALUES
		('extract_lessons', jsonb_build_object('at', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
		('extract_facts', jsonb_build_object('at', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
	ON CONFLICT (key) DO UPDATE
		SET value = excluded.value, updated_at = now()
		WHERE (brain_state.value ->> 'at') IS NULL OR (brain_state.value ->> 'at')::timestamptz < v_now;

	-- 4. drop the legacy tables + types
	DROP TABLE IF EXISTS redline_patterns CASCADE;
	DROP TABLE IF EXISTS redline_lessons CASCADE;
	DROP TABLE IF EXISTS redline_revisions CASCADE;
	DROP TABLE IF EXISTS redline_pairs CASCADE;
	DROP TABLE IF EXISTS redline_drafts CASCADE;
	DROP TABLE IF EXISTS redline_derivation_jobs CASCADE;
	DROP TYPE IF EXISTS redline_author CASCADE;
	DROP TYPE IF EXISTS redline_confidence CASCADE;
	DROP TYPE IF EXISTS redline_direction CASCADE;
	DROP TYPE IF EXISTS redline_draft_status CASCADE;
	DROP TYPE IF EXISTS redline_job_status CASCADE;
	DROP TYPE IF EXISTS redline_pattern_type CASCADE;
	DROP TYPE IF EXISTS redline_surface CASCADE;
END $$;
