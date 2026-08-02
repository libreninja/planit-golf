-- Per-round authoritative season-points entries, captured at import time from
-- GG's embedded event.season_points (summed across the Gross and Net
-- tournaments, which credit the same season_point_category; women's returns an
-- empty array → no rows). One row per (league, week, member) carrying that
-- round's total_points. rebuildSeasonPoints sums these across completed rounds
-- to re-derive the cumulative standings durably. Service-role-only: only the
-- reconciliation pipeline (service client) reads/writes this; no public SELECT.
-- See design spec §5 + Migration 026 reference in Task 19F.

CREATE TABLE igc_league_season_point_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_key TEXT NOT NULL CHECK (league_key IN ('mens', 'womens')),
    week_number INTEGER NOT NULL,
    member_card_id TEXT NOT NULL,
    total_points NUMERIC(10,2) DEFAULT 0,
    player_name TEXT,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(league_key, week_number, member_card_id)
);

CREATE INDEX idx_league_season_point_entries_league_week
    ON igc_league_season_point_entries(league_key, week_number);
CREATE INDEX idx_league_season_point_entries_member
    ON igc_league_season_point_entries(league_key, member_card_id);

ALTER TABLE igc_league_season_point_entries ENABLE ROW LEVEL SECURITY;
-- Intentionally NO public policy: service-role-only (same posture as
-- competition_live_cache). The service client bypasses RLS.
