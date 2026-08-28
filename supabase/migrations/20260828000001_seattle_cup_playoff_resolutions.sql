-- Planit-owned, out-of-band Seattle Cup playoff result. Normal Golf Genius
-- matches, point standings, tied leaders, and head-to-head match wins remain
-- derived and are deliberately not persisted here.

CREATE TABLE public.seattle_cup_playoff_resolutions (
    event_key TEXT PRIMARY KEY,
    season INTEGER NOT NULL,
    gg_event_id TEXT NOT NULL,
    tied_team_keys TEXT[] NOT NULL,
    winner_team_key TEXT NOT NULL,
    notes TEXT,
    resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recorded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (season, gg_event_id),
    CHECK (cardinality(tied_team_keys) >= 2),
    CHECK (tied_team_keys <@ ARRAY['interbay', 'jackson-park', 'bill-wright', 'west-seattle']::TEXT[]),
    CHECK (winner_team_key = ANY(tied_team_keys)),
    CHECK (notes IS NULL OR char_length(notes) <= 2000)
);

ALTER TABLE public.seattle_cup_playoff_resolutions ENABLE ROW LEVEL SECURITY;

-- Intentionally no anon/authenticated policies. Reads and writes go through
-- authenticated Planit server code using the service role, after requireAdmin
-- and rules-derived validation. The public API exposes only the small derived
-- tournamentResolution contract, never notes or actor metadata.
