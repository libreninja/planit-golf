ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS league TEXT CHECK (league IN ('mens', 'womens'));

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS league TEXT CHECK (league IN ('mens', 'womens')),
  ADD COLUMN IF NOT EXISTS golf_event_id TEXT,
  ADD COLUMN IF NOT EXISTS golf_round_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS events_golf_round_id_key
  ON public.events (golf_round_id)
  WHERE golf_round_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS members_league_idx ON public.members (league);
CREATE INDEX IF NOT EXISTS events_league_event_date_idx ON public.events (league, event_date);
