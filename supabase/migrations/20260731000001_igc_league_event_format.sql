-- Replace the overloaded `gg_tournament_id IS NULL` team-event signal with an
-- explicit, independently-stored event format and discovery state. A null
-- external id is data absence, not a semantic classification (see design spec
-- §3). Also adds the durable-current contract columns (spec §5): the
-- reconciler records when the upstream source was finalized and when our
-- durable import captured that finalized state, so the live read path can
-- derive `durableCurrent` from a real comparison rather than a guess.
-- Additive only: no existing column is dropped/retyped.

ALTER TABLE igc_league_events
    ADD COLUMN event_format TEXT NOT NULL DEFAULT 'unknown'
        CHECK (event_format IN ('individual', 'team', 'unknown')),
    ADD COLUMN discovery_state TEXT NOT NULL DEFAULT 'pending'
        CHECK (discovery_state IN ('pending', 'discovered', 'inconclusive', 'failed')),
    ADD COLUMN discovered_at TIMESTAMPTZ,
    ADD COLUMN source_finalized_at TIMESTAMPTZ,   -- when GG said this round was finalized
    ADD COLUMN source_version TEXT,              -- GG source version token, if exposed
    ADD COLUMN durable_source_version TEXT,      -- the source version our durable import captured
    ADD COLUMN durable_imported_at TIMESTAMPTZ;  -- when our import captured the finalized source

CREATE INDEX idx_league_events_format_state
    ON igc_league_events(league_key, event_format, discovery_state);

-- Backfill (conservative; never asserts 'team' from a null id). Rows with a
-- linked individual tournament are known individual events; everything else
-- stays 'unknown' for the reconciler to re-classify from current GG data.
UPDATE igc_league_events
   SET event_format = 'individual', discovery_state = 'discovered'
 WHERE gg_tournament_id IS NOT NULL;