-- Clubs
CREATE TABLE clubs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    short_name TEXT,
    description TEXT,
    logo_url TEXT,
    is_public BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Club follows
CREATE TABLE club_follows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, club_id)
);

-- Event-Club relationship
CREATE TABLE event_clubs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_series_id UUID NOT NULL REFERENCES event_series(id) ON DELETE CASCADE,
    club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    relationship_type TEXT DEFAULT 'host' CHECK (relationship_type IN ('host', 'sponsor', 'participating')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_series_id, club_id)
);

-- Club memberships
CREATE TABLE club_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member' CHECK (role IN ('member', 'officer', 'admin')),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'revoked')),
    invited_by UUID REFERENCES auth.users(id),
    invite_token TEXT, -- legacy Good to Go support
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, club_id)
);

-- Event follows
CREATE TABLE event_follows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    event_edition_id UUID NOT NULL REFERENCES event_editions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, event_edition_id)
);

-- Event participants
CREATE TABLE event_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_edition_id UUID NOT NULL REFERENCES event_editions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    participant_type TEXT DEFAULT 'player' CHECK (participant_type IN ('player', 'spectator', 'organizer')),
    status TEXT DEFAULT 'registered' CHECK (status IN ('invited', 'registered', 'confirmed', 'cancelled')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_edition_id, user_id)
);

-- RLS Policies
ALTER TABLE clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_participants ENABLE ROW LEVEL SECURITY;

-- Clubs: public can view public clubs
CREATE POLICY "Public can view public clubs"
    ON clubs FOR SELECT
    USING (is_public = true);

-- Club follows: users manage their own
CREATE POLICY "Users manage their club follows"
    ON club_follows FOR ALL
    USING (user_id = auth.uid());

-- Club memberships: users view their own
CREATE POLICY "Users view their memberships"
    ON club_memberships FOR SELECT
    USING (user_id = auth.uid());

-- Event follows: users manage their own
CREATE POLICY "Users manage their event follows"
    ON event_follows FOR ALL
    USING (user_id = auth.uid());

-- Triggers
CREATE TRIGGER clubs_updated_at
    BEFORE UPDATE ON clubs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER club_memberships_updated_at
    BEFORE UPDATE ON club_memberships
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER event_participants_updated_at
    BEFORE UPDATE ON event_participants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed IGC club
INSERT INTO clubs (slug, name, short_name, description, is_public)
VALUES (
    'igc',
    'Interbay Golf Club',
    'IGC',
    'Seattle golf community with year-round events and competitions',
    true
);
