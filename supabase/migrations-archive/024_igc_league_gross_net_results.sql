-- Corrective, purely additive migration for IGC league results.
--
-- Two bugs found by validating the persisted data against Golf Genius:
--
--   1. SEASON POINTS WERE WEEKLY, NOT CUMULATIVE. The 023 sync stored the
--      latest round's `event.season_points[].total_points` as if it were the
--      cumulative season total. In GG that field is the points awarded IN THAT
--      ROUND (max 500), not the running total. The authoritative cumulative
--      standings (e.g. Hans Olson ≈ 4141.84) are the SUM of weekly
--      total_points across every completed round AND both the Gross and Net
--      competitions (they share one season_point_category). No GG endpoint
--      exposes the cumulative total directly (all candidates 404), so the sync
--      now accumulates it. No schema change is needed for this fix —
--      igc_league_season_points.total_points already holds the right shape; the
--      sync just populates it correctly.
--
--   2. ONLY ONE COMPETITION WAS PERSISTED. The 023 sync picked a single
--      tournament (Net) and discarded the Gross competition. GG models a league
--      round as TWO individual tournaments — "Gross Regular Season" / "Net
--      Regular Season" (men's), "Gross Individual Play" / "Net Individual
--      Play" (women's) — each scoped by flight (men's: Flight 1/2/3; women's:
--      Overall). The SAME player appears in both with an IDENTICAL hole-by-hole
--      scorecard; only the result (position, points, purse) differs. So the
--      scorecard is ONE fact and the Gross/Net placements are two result
--      memberships of it. This migration adds a result-membership table so both
--      competitions are preserved without duplicating the scorecard.
--
-- Additive only: no existing column is dropped/renamed/retyped. The 023
-- scorecard columns on igc_league_performances remain (the scorecard fact); the
-- per-competition result now lives in igc_league_results.

-- Link each event row to BOTH individual tournaments so live re-fetch can get
-- both competitions. gg_tournament_id (023) is retained and holds the Net
-- tournament id (null for team weeks), so the existing team-event detection
-- (gg_tournament_id IS NULL) keeps working unchanged.
ALTER TABLE igc_league_events
    ADD COLUMN gg_gross_tournament_id TEXT,
    ADD COLUMN gg_net_tournament_id TEXT;

-- Per-player-round × competition result membership. The scorecard itself
-- (gross/net hole scores, to-par, totals, holes completed) lives ONCE in
-- igc_league_performances; this table holds only the competition-specific
-- placement: which competition (gross/net), which flight, finishing position,
-- points awarded, and purse. Two rows per player-round for individual weeks
-- (gross + net); none for team/scramble weeks.
CREATE TABLE igc_league_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_key TEXT NOT NULL CHECK (league_key IN ('mens', 'womens')),
    week_number INTEGER NOT NULL,
    event_id UUID REFERENCES igc_league_events(id) ON DELETE CASCADE,
    member_card_id TEXT NOT NULL,        -- league aggregates always carry this
    player_name TEXT NOT NULL,
    competition TEXT NOT NULL CHECK (competition IN ('gross', 'net')),
    flight_name TEXT,                    -- "Flight 1/2/3" (men's) / "Overall" (women's)
    position_label TEXT,                 -- GG raw "1", "T2", "--"
    flight_position INTEGER,             -- parsed numeric finishing position
    points NUMERIC(10,2),                -- men's weekly points; NULL for women's
    purse TEXT,                          -- "$55.00"
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(league_key, week_number, member_card_id, competition)
);

CREATE INDEX idx_league_results_lookup ON igc_league_results(league_key, week_number, competition);
CREATE INDEX idx_league_results_flight ON igc_league_results(league_key, week_number, flight_name, competition);
CREATE INDEX idx_league_results_member ON igc_league_results(league_key, member_card_id);

ALTER TABLE igc_league_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view league results"
    ON igc_league_results FOR SELECT
    USING (true);