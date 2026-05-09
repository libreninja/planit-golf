-- External sync runs
CREATE TABLE external_sync_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL, -- golf_genius, manual
    source_event_id TEXT,
    event_edition_id UUID REFERENCES event_editions(id),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    records_processed INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Raw payloads for debugging
CREATE TABLE external_raw_payloads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_run_id UUID NOT NULL REFERENCES external_sync_runs(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    payload JSONB NOT NULL,
    received_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_sync_runs_edition ON external_sync_runs(event_edition_id);
CREATE INDEX idx_sync_runs_status ON external_sync_runs(status);

-- RLS (admin only)
ALTER TABLE external_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_raw_payloads ENABLE ROW LEVEL SECURITY;

-- Only admins can access sync data
CREATE POLICY "Admins can view sync runs"
    ON external_sync_runs FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND (profiles.is_admin = true OR profiles.is_system_admin = true)
        )
    );
