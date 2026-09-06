-- Supabase cron: wake the Fly dashboard to run a scheduler tick ONLY when the
-- database says work is due. The dashboard is stateless (auto_stop_machines =
-- stop, min_machines_running = 0) — this gate means it only spins up around
-- actual publish/send times, not on a blind schedule.
--
-- One-time setup, run against the PRODUCTION Supabase SQL editor (not a
-- numbered migration — extensions + secrets are env-specific). Same pattern
-- as cron/brain-cycle.sql:
--
--   1. Extensions (already on if brain-cycle is installed):
--      create extension if not exists pg_cron;
--      create extension if not exists pg_net;
--   2. Vault secret — REUSES 'brain-cron-secret'; both jobs hit the same
--      CRON_SECRET env on Fly. Skip this step if brain-cycle is installed.
--
-- Unschedule: select cron.unschedule('scheduler-tick');

select cron.schedule(
  'scheduler-tick',
  '* * * * *',
  $cron$
  do $gate$
  begin
    if
      -- due docs (LinkedIn/newsletter) or scheduled emails
      exists (select 1 from docs where status = 'scheduled' and scheduled_for <= now())
      or exists (select 1 from email_outbox where status = 'draft' and send_at <= now())
      -- crashed dispatches needing stale-reclaim
      or exists (select 1 from docs where status = 'publishing' and updated_at <= now() - interval '5 minutes')
      or exists (select 1 from email_outbox where status = 'sending' and updated_at <= now() - interval '5 minutes')
    then
      perform net.http_post(
        url := 'https://app.madcactus.org/api/scheduler/tick',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'brain-cron-secret')
        ),
        body := jsonb_build_object('trigger', 'supabase-cron'),
        timeout_milliseconds := 30000
      );
    end if;
  end;
  $gate$;
  $cron$
);
