-- Short-TTL server cache for coalesced live-result + discovery reads. Written
-- and read ONLY by the service role from server routes; there is no
-- browser-side need for direct reads. RLS is ENABLED with NO public SELECT
-- policy, so anon/authenticated roles cannot read it. The cache key includes
-- tenant_key so competition keys need not be globally unique across tenants.
-- See design spec §4 (revision 8).

CREATE TABLE competition_live_cache (
    cache_key          TEXT PRIMARY KEY,
    tenant_key         TEXT NOT NULL,
    competition_key    TEXT NOT NULL,
    occurrence_id      TEXT NOT NULL,
    scope              TEXT NOT NULL CHECK (scope IN ('results', 'discovery')),
    scoring            TEXT,                            -- null for discovery rows
    payload            JSONB NOT NULL,
    result_status      TEXT,
    fetched_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at         TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_competition_live_cache_expires ON competition_live_cache(expires_at);
CREATE INDEX idx_competition_live_cache_comp_occ ON competition_live_cache(tenant_key, competition_key, occurrence_id);

ALTER TABLE competition_live_cache ENABLE ROW LEVEL SECURITY;
-- Intentionally NO public SELECT policy: only the service role (server routes)
-- reads/writes. No INSERT/UPDATE/DELETE policies either — all writes go
-- through the service client which bypasses RLS.