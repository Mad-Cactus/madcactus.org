-- Cron jobs as code. cron.schedule() replaces any existing job with the same
-- name, so re-running this is safe — this file plus later overrides are the
-- source of truth for schedules. To change a schedule or command later, add a
-- NEW migration calling cron.schedule with the same job name (append-only, like
-- any migration).
--
-- Env-specific prerequisite (deliberately NOT in git — secret value never in
-- migrations). Run once per environment, in the Supabase SQL editor:
--   select vault.create_secret('<CRON_SECRET>', 'brain-cron-secret');
-- ('brain-cron-secret' must match CRON_SECRET on the Fly app. On a fresh
-- environment without the secret the jobs exist but fail until it's created.)
--
-- Old one-time-setup scripts lived in supabase/cron/ — deleted; this replaces them.

-- Guarded so the migrations replay on plain Postgres (CI), where pg_cron and
-- pg_net don't exist. On Supabase both are enabled by the baseline.
do $outer$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net')
  then
    -- Brain cycle: daily 06:00 ET (10:00 UTC).
    perform cron.schedule(
      'brain-cycle',
      '0 10 * * *',
      $job$
      select net.http_post(
        url := 'https://madcactus.org/api/brain/cycle',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'brain-cron-secret')
        ),
        body := jsonb_build_object('trigger', 'supabase-cron')
      );
      $job$
    );

    -- Scheduler tick: every minute, but only POSTs when the DB says work is due.
    -- The dashboard is stateless (auto_stop_machines = stop, min_machines_running
    -- = 0) — this gate means it only spins up around actual publish/send times.
    perform cron.schedule(
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
            url := 'https://madcactus.org/api/scheduler/tick',
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
  end if;
end
$outer$;
