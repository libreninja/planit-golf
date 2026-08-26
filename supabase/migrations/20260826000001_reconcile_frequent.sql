-- Frequent reconcile: keep the league DB within ~a couple minutes of Golf Genius.
--
-- The Vercel cron in vercel.json runs /api/cron/reconcile once per day (Hobby
-- plan caps crons at once-per-day), so a finalized round can lag GG by up to 24h
-- and a not-yet-reconciled round shows "Results aren't available" once it is no
-- longer "today". This schedule triggers the SAME endpoint every 2 min so a
-- finalized round is imported within ~2 min of GG publishing season_points and
-- the latest round renders + becomes the default immediately.
--
-- The run self-gates to the play window in practice: off-window there is no
-- in-progress candidate and no finalized-not-durable candidate, so every
-- candidate is 'skip' (old-current) and the run makes 0 GG calls. The staleness
-- gate in selectReconciliationCandidates (lib/competition/reconcile/candidates.ts)
-- further ensures an occurrence is re-read from GG at most once per 60s.
--
-- pg_cron + pg_net are already enabled on this project (the while-supplies-last
-- bot uses the same pattern in 001_gh_trigger.sql); CREATE EXTENSION is a no-op.
-- The daily Vercel cron (vercel.json) remains as a backstop in case this job stops.
--
-- Secrets: the reconcile endpoint is auth-gated by CRON_SECRET (Bearer). The URL
-- and secret are read from database GUCs that must be set OUT OF BAND (Supabase
-- dashboard SQL editor — NOT committed) once for this project:
--
--   ALTER DATABASE postgres SET app.reconcile_url = 'https://www.planit.golf/api/cron/reconcile';
--   ALTER DATABASE postgres SET app.cron_secret = '<prod CRON_SECRET>';
--
-- Until those GUCs are set the job's requests carry an empty Bearer and 401
-- harmlessly (the daily Vercel cron still works). net.http_get is fire-and-forget
-- (the response lands in net._http_response; we only need to trigger the run).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Idempotent: drop any prior job of this name (no-op if absent) before scheduling.
DO $$
BEGIN
  PERFORM cron.unschedule('reconcile-frequent');
EXCEPTION WHEN OTHERS THEN
  -- older pg_cron raises for an unknown job name; safe to ignore
  NULL;
END $$;

SELECT cron.schedule(
  'reconcile-frequent',
  '*/2 * * * *',  -- every 2 minutes, UTC (pg_cron.timezone). 90s route budget < 120s cadence → no self-overlap.
  $$
  SELECT net.http_get(
    url := current_setting('app.reconcile_url', true),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.cron_secret', true)
    )
  )
  $$
);