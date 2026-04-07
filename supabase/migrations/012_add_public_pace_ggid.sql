-- Store public QR timing runs keyed by the Golf Genius group ID.

ALTER TABLE public.public_pace_scans
  ADD COLUMN IF NOT EXISTS group_ggid TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finished_checkpoint_id UUID REFERENCES public.public_pace_checkpoints(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS continuation_token TEXT;

ALTER TABLE public.public_pace_scans
  ALTER COLUMN tee_time DROP NOT NULL,
  ALTER COLUMN actual_start_at DROP NOT NULL;

UPDATE public.public_pace_scans
SET started_at = COALESCE(started_at, actual_start_at, scanned_at)
WHERE started_at IS NULL;

ALTER TABLE public.public_pace_scans
  ALTER COLUMN started_at SET DEFAULT NOW(),
  ALTER COLUMN started_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS public_pace_scans_group_ggid_idx
  ON public.public_pace_scans (event_date, group_ggid)
  WHERE group_ggid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS public_pace_scans_continuation_token_key
  ON public.public_pace_scans (continuation_token)
  WHERE continuation_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS public_pace_scans_completed_leaderboard_idx
  ON public.public_pace_scans (event_date, checkpoint_id, finished_at)
  WHERE finished_at IS NOT NULL;
