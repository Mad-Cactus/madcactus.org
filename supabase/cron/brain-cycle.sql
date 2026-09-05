-- Supabase cron: run the brain cycle daily at 06:00 ET (10:00 UTC).
--
-- One-time setup, run against the PRODUCTION Supabase SQL editor (not a
-- numbered migration — it wires scheduler secrets, it's env-specific):
--
--   1. Enable extensions (Dashboard → Database → Extensions, or):
--      create extension if not exists pg_cron;
--      create extension if not exists pg_net;
--   2. Store the secret (must match CRON_SECRET on the Fly app):
--      select vault.create_secret('<CRON_SECRET>', 'brain-cron-secret');
--   3. Run this file.
--
-- Unschedule: select cron.unschedule('brain-cycle');

select cron.schedule(
  'brain-cycle',
  '0 10 * * *',
  $$
  select net.http_post(
    url := 'https://app.madcactus.org/api/brain/cycle',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'brain-cron-secret')
    ),
    body := jsonb_build_object('trigger', 'supabase-cron')
  );
  $$
);
