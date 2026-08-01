-- Rich Golf Genius league results.
--
-- The 021 league schema stored only hole-by-hole net scores and a within-flight
-- rank, discarding the actual competition result (flight, points awarded, gross
-- scores, to-par, totals, purse, scoring status) and the cumulative season
-- points. This migration is PURELY ADDITIVE: it adds nullable columns to the
-- existing igc_league_events / igc_league_performances tables and introduces two
-- cache tables (season-points snapshot, member-card→name roster) so the league
-- pages can present authoritative GG data without re-deriving it from
-- birdie/double counts. No existing column is dropped, renamed, or retyped, so
-- current app code is unaffected.

-- Per-round event: link to the specific GG round + tournament and record
-- scoring status, so an actively scoring round can be detected and a round's
-- results can be re-fetched live without re-deriving the round by date.
ALTER TABLE igc_league_events
    ADD COLUMN gg_round_id TEXT,
    ADD COLUMN gg_tournament_id TEXT,
    ADD COLUMN results_released BOOLEAN,
    ADD COLUMN scored_at TIMESTAMPTZ;

-- Per-player round result: authoritative competition data straight from GG.
-- `flight` (A/B/C) and `flight_position` and `net_scores` already exist from
-- 021; `flight_name` stores GG's own scope label ("Flight 1/2/3") which does
-- not fit the existing A/B/C CHECK constraint. `position_label` keeps GG's raw
-- position ("1", "T2", "--") for display.
ALTER TABLE igc_league_performances
    ADD COLUMN flight_name TEXT,
    ADD COLUMN position_label TEXT,
    ADD COLUMN points NUMERIC(10,2),            -- authoritative points awarded this round
    ADD COLUMN gross_scores INTEGER[],           -- hole-by-hole gross
    ADD COLUMN to_par_net INTEGER[],             -- hole-by-hole net to-par
    ADD COLUMN to_par_gross INTEGER[],           -- hole-by-hole gross to-par
    ADD COLUMN net_total INTEGER,                -- net stroke total (out)
    ADD COLUMN gross_total INTEGER,              -- gross stroke total (out)
    ADD COLUMN to_par_net_total INTEGER,         -- net to-par total
    ADD COLUMN to_par_gross_total INTEGER,       -- gross to-par total
    ADD COLUMN purse TEXT,                       -- e.g. "$55.00"
    ADD COLUMN holes_completed INTEGER,          -- "thru": count of scored holes
    ADD COLUMN scorecard_status TEXT;            -- from GG scorecard_statuses

-- Season-points snapshot (authoritative cumulative race). `position` and
-- `total_points` come straight from GG's embedded event.season_points;
-- `previous_position` comes from the prior completed round's season_points;
-- `events_played` and `wins` are derived from the stored weekly performances
-- (authoritative position/flight data, not birdie counts). `points_behind` is
-- the gap to the leader. Separate from the legacy (unused) igc_league_standings
-- table, whose INTEGER total_points and CHECK trend do not fit GG's decimal
-- points.
CREATE TABLE igc_league_season_points (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_key TEXT NOT NULL CHECK (league_key IN ('mens', 'womens')),
    member_card_id TEXT NOT NULL,
    player_name TEXT,
    position INTEGER,
    previous_position INTEGER,
    total_points NUMERIC(10,2),
    events_played INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    points_behind NUMERIC(10,2),
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(league_key, member_card_id)
);

-- Member-card→name roster cache, from GG /events/{id}/roster. Needed because
-- GG's season_points identifies players only by member_card_id.
CREATE TABLE igc_league_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_key TEXT NOT NULL CHECK (league_key IN ('mens', 'womens')),
    member_card_id TEXT NOT NULL,
    name TEXT,
    email TEXT,
    handicap_index TEXT,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(league_key, member_card_id)
);

CREATE INDEX idx_league_events_round ON igc_league_events(gg_round_id);
CREATE INDEX idx_league_performances_flight_name ON igc_league_performances(flight_name);
CREATE INDEX idx_league_season_points_league_pos ON igc_league_season_points(league_key, position);
CREATE INDEX idx_league_season_points_member ON igc_league_season_points(league_key, member_card_id);
CREATE INDEX idx_league_members_member ON igc_league_members(league_key, member_card_id);

-- RLS: public can read league results/standings/roster (same posture as 021).
ALTER TABLE igc_league_season_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE igc_league_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view league season points"
    ON igc_league_season_points FOR SELECT
    USING (true);

CREATE POLICY "Public can view league members"
    ON igc_league_members FOR SELECT
    USING (true);

-- Note: no BEFORE UPDATE trigger on the two new tables. They carry synced_at
-- (set explicitly by the sync on every upsert), not updated_at, and the
-- shared update_updated_at() function from 021 references NEW.updated_at.