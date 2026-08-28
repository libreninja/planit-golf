-- Out-of-band Seattle Cup playoff resolution. Everything else about the Cup
-- winner (final standings, tied leaders, 2-team head-to-head MATCH WINS,
-- playoff-required) is DERIVED from the normalized match data in
-- lib/seattle-cup/resolution.ts. The ONLY fact the normalized data cannot tell
-- us is the result of the sudden-death fourball playoff, which happens outside
-- Golf Genius — so that single fact is persisted here, tied to the locked
-- season/event identity. RLS is ENABLED with NO public policies: reads and
-- writes go through the service role from server routes/actions only (same
-- convention as competition_live_cache).

CREATE TABLE seattle_cup_tournament_results (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_key   TEXT NOT NULL,
    season_year       INT NOT NULL,
    gg_event_id       TEXT NOT NULL,
    winner_team_key   TEXT NOT NULL CHECK (winner_team_key IN
                        ('interbay', 'jackson-park', 'bill-wright', 'west-seattle')),
    tied_team_keys    TEXT[] NOT NULL,
    notes             TEXT,
    resolved_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_by       UUID REFERENCES profiles(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- One authoritative resolution per competition season/event.
    UNIQUE (competition_key, gg_event_id)
);

ALTER TABLE seattle_cup_tournament_results ENABLE ROW LEVEL SECURITY;
-- Intentionally NO public SELECT/INSERT/UPDATE/DELETE policies: only the
-- service role (server actions/routes) reads and writes.