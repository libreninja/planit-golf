-- Public QR checkpoint timing for unauthenticated scan flows.

CREATE TABLE IF NOT EXISTS public.public_pace_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  course_name TEXT NOT NULL DEFAULT 'Interbay Golf Center',
  league TEXT CHECK (league IN ('mens', 'womens')),
  hole_number INT CHECK (hole_number > 0),
  scan_window_minutes INT NOT NULL DEFAULT 240 CHECK (scan_window_minutes > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER update_public_pace_checkpoints_updated_at
  BEFORE UPDATE ON public.public_pace_checkpoints
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.public_pace_checkpoints ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.public_pace_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkpoint_id UUID NOT NULL REFERENCES public.public_pace_checkpoints(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  event_date DATE NOT NULL,
  league TEXT CHECK (league IN ('mens', 'womens')),
  golf_event_id TEXT,
  golf_round_id TEXT,
  foursome_key TEXT NOT NULL,
  tee_time TEXT NOT NULL,
  actual_start_at TIMESTAMPTZ NOT NULL,
  player_names TEXT[] NOT NULL DEFAULT '{}',
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(checkpoint_id, event_date, foursome_key)
);

CREATE INDEX IF NOT EXISTS public_pace_checkpoints_token_idx
  ON public.public_pace_checkpoints (token)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS public_pace_scans_leaderboard_idx
  ON public.public_pace_scans (event_date, checkpoint_id, scanned_at);

ALTER TABLE public.public_pace_scans ENABLE ROW LEVEL SECURITY;

INSERT INTO public.public_pace_checkpoints (token, label, course_name, league, hole_number)
VALUES
  ('interbay-checkpoint-1', 'Checkpoint 1', 'Interbay Golf Center', NULL, NULL),
  ('interbay-checkpoint-2', 'Checkpoint 2', 'Interbay Golf Center', NULL, NULL)
ON CONFLICT (token) DO NOTHING;
