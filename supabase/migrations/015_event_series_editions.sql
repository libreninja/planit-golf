-- Event Series (recurring events)
CREATE TABLE event_series (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    is_public BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Event Editions (specific instances)
CREATE TABLE event_editions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_series_id UUID NOT NULL REFERENCES event_series(id) ON DELETE CASCADE,
    slug TEXT, -- optional custom slug
    year INTEGER NOT NULL,
    starts_on DATE,
    ends_on DATE,
    location_name TEXT,
    visibility TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'club_members', 'invite_only')),
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
    golf_genius_event_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_series_id, year)
);

-- RLS Policies
ALTER TABLE event_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_editions ENABLE ROW LEVEL SECURITY;

-- Public can view public series
CREATE POLICY "Public can view public series"
    ON event_series FOR SELECT
    USING (is_public = true);

-- Public can view public editions
CREATE POLICY "Public can view public editions"
    ON event_editions FOR SELECT
    USING (
        visibility = 'public'
        AND EXISTS (
            SELECT 1 FROM event_series
            WHERE event_series.id = event_editions.event_series_id
            AND event_series.is_public = true
        )
    );

-- Update triggers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_series_updated_at
    BEFORE UPDATE ON event_series
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER event_editions_updated_at
    BEFORE UPDATE ON event_editions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
