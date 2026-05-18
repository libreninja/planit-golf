-- IGC League tables for weekly leaderboard and blog content
-- Stores processed Golf Genius data for live display

-- Clean up old test data from igc_events (remove bogus entries)
DELETE FROM igc_events WHERE name ILIKE '%bandon%' OR name ILIKE '%test%' OR slug ILIKE '%test%';

-- Events table (for selecting/viewing specific events)
CREATE TABLE igc_league_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_key TEXT NOT NULL CHECK (league_key IN ('mens', 'womens')),
    week_number INTEGER NOT NULL,
    gg_event_id TEXT NOT NULL,
    event_name TEXT NOT NULL,
    event_date DATE NOT NULL,
    course_name TEXT,
    status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'live', 'finalized')),
    flights_finalized BOOLEAN DEFAULT false,
    finalized_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(league_key, week_number)
);

-- Weekly player performances (now with flight support)
CREATE TABLE igc_league_performances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_key TEXT NOT NULL, -- 'mens_tuesday' or 'womens_wednesday'
    week_number INTEGER NOT NULL,
    event_id UUID REFERENCES igc_league_events(id) ON DELETE CASCADE,
    player_name TEXT NOT NULL,
    member_card_id TEXT,
    flight TEXT CHECK (flight IN ('A', 'B', 'C')), -- Only assigned after finalized
    event_name TEXT NOT NULL,
    event_date DATE,
    double_bogeys INTEGER DEFAULT 0,
    birdies INTEGER DEFAULT 0,
    weekly_position INTEGER NOT NULL, -- Overall position before flights
    flight_position INTEGER, -- Position within flight (once assigned)
    ranking_change INTEGER, -- positive = improved
    net_scores INTEGER[], -- nullable array for hole-by-hole
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(league_key, week_number, player_name)
);

-- Blog posts for weekly recaps (Substack integration)
CREATE TABLE igc_league_blog_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_key TEXT NOT NULL,
    week_number INTEGER NOT NULL,
    title TEXT,
    content TEXT NOT NULL,
    storylines JSONB DEFAULT '[]', -- structured storylines for easy editing
    pace_notes JSONB DEFAULT '[]',
    published BOOLEAN DEFAULT false,
    published_at TIMESTAMPTZ,
    substack_url TEXT, -- link to published post
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(league_key, week_number)
);

-- Season points standings (cached from GG)
CREATE TABLE igc_league_standings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_key TEXT NOT NULL,
    season_points_category_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    member_card_id TEXT,
    total_points INTEGER DEFAULT 0,
    rank INTEGER NOT NULL,
    events_played INTEGER DEFAULT 0,
    trend TEXT CHECK (trend IN ('up', 'down', 'stable')),
    last_week_rank INTEGER,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(league_key, player_name)
);

-- Indexes
CREATE INDEX idx_league_events_league ON igc_league_events(league_key);
CREATE INDEX idx_league_events_date ON igc_league_events(event_date);
CREATE INDEX idx_league_performances_league ON igc_league_performances(league_key);
CREATE INDEX idx_league_performances_week ON igc_league_performances(week_number);
CREATE INDEX idx_league_performances_event ON igc_league_performances(event_id);
CREATE INDEX idx_league_performances_player ON igc_league_performances(player_name);
CREATE INDEX idx_league_performances_flight ON igc_league_performances(flight);
CREATE INDEX idx_league_standings_league ON igc_league_standings(league_key);

-- RLS
ALTER TABLE igc_league_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE igc_league_performances ENABLE ROW LEVEL SECURITY;
ALTER TABLE igc_league_blog_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE igc_league_standings ENABLE ROW LEVEL SECURITY;

-- Public can view events, performances and standings
CREATE POLICY "Public can view league events"
    ON igc_league_events FOR SELECT
    USING (true);

CREATE POLICY "Public can view league performances"
    ON igc_league_performances FOR SELECT
    USING (true);

CREATE POLICY "Public can view league standings"
    ON igc_league_standings FOR SELECT
    USING (true);

-- Only admins can manage blog posts
CREATE POLICY "Admins can manage blog posts"
    ON igc_league_blog_posts FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND (profiles.is_admin = true OR profiles.is_system_admin = true)
        )
    );

-- Triggers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER league_events_updated_at
    BEFORE UPDATE ON igc_league_events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER league_performances_updated_at
    BEFORE UPDATE ON igc_league_performances
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER league_blog_posts_updated_at
    BEFORE UPDATE ON igc_league_blog_posts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
