-- Check which tables exist and apply only missing migrations
-- Run each block separately based on error messages

-- Migration 015: Event Series and Editions
-- Only run if event_series doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'event_series') THEN
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
            slug TEXT,
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

        CREATE POLICY "Public can view public series"
            ON event_series FOR SELECT
            USING (is_public = true);

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

        -- Triggers
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
    END IF;
END $$;

-- Migration 016: Clubs and Memberships
-- Only run if clubs doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'clubs') THEN
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

        CREATE TABLE club_follows (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
            club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(user_id, club_id)
        );

        CREATE TABLE event_clubs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            event_series_id UUID NOT NULL REFERENCES event_series(id) ON DELETE CASCADE,
            club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
            relationship_type TEXT DEFAULT 'host' CHECK (relationship_type IN ('host', 'sponsor', 'participating')),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(event_series_id, club_id)
        );

        CREATE TABLE club_memberships (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
            club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
            role TEXT DEFAULT 'member' CHECK (role IN ('member', 'officer', 'admin')),
            status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'revoked')),
            invited_by UUID REFERENCES auth.users(id),
            invite_token TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(user_id, club_id)
        );

        CREATE TABLE event_follows (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
            event_edition_id UUID NOT NULL REFERENCES event_editions(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(user_id, event_edition_id)
        );

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

        CREATE POLICY "Public can view public clubs"
            ON clubs FOR SELECT
            USING (is_public = true);

        CREATE POLICY "Users manage their club follows"
            ON club_follows FOR ALL
            USING (user_id = auth.uid());

        CREATE POLICY "Users view their memberships"
            ON club_memberships FOR SELECT
            USING (user_id = auth.uid());

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
    END IF;
END $$;

-- Migration 017: Feed System
-- Only run if feed_events doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'feed_events') THEN
        CREATE TABLE feed_events (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            subject_type TEXT NOT NULL CHECK (subject_type IN ('event_edition', 'club', 'trip', 'user')),
            subject_id UUID NOT NULL,
            actor_type TEXT DEFAULT 'system' CHECK (actor_type IN ('system', 'user', 'external_sync')),
            actor_id UUID REFERENCES auth.users(id),
            type TEXT NOT NULL,
            data JSONB DEFAULT '{}',
            visibility TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'club_members', 'participants', 'admins')),
            dedupe_key TEXT,
            is_pinned BOOLEAN DEFAULT false,
            is_hidden BOOLEAN DEFAULT false,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE feed_reactions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            feed_event_id UUID NOT NULL REFERENCES feed_events(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
            reaction_type TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(feed_event_id, user_id, reaction_type)
        );

        -- Indexes
        CREATE INDEX idx_feed_events_subject ON feed_events(subject_type, subject_id);
        CREATE INDEX idx_feed_events_created ON feed_events(created_at DESC);
        CREATE INDEX idx_feed_events_dedupe ON feed_events(dedupe_key) WHERE dedupe_key IS NOT NULL;
        CREATE INDEX idx_feed_events_pinned ON feed_events(is_pinned) WHERE is_pinned = true;

        -- RLS
        ALTER TABLE feed_events ENABLE ROW LEVEL SECURITY;
        ALTER TABLE feed_reactions ENABLE ROW LEVEL SECURITY;

        CREATE POLICY "Public can view public feed events"
            ON feed_events FOR SELECT
            USING (visibility = 'public' AND is_hidden = false);

        CREATE POLICY "Users manage their reactions"
            ON feed_reactions FOR ALL
            USING (user_id = auth.uid());
    END IF;
END $$;

-- Migration 018: External Sync Tracking (already exists based on error)
-- Skip if external_sync_runs exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'external_sync_runs') THEN
        CREATE TABLE external_sync_runs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            source TEXT NOT NULL,
            source_event_id TEXT,
            event_edition_id UUID REFERENCES event_editions(id),
            status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
            started_at TIMESTAMPTZ DEFAULT NOW(),
            completed_at TIMESTAMPTZ,
            error_message TEXT,
            records_processed INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE external_raw_payloads (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            sync_run_id UUID NOT NULL REFERENCES external_sync_runs(id) ON DELETE CASCADE,
            endpoint TEXT NOT NULL,
            payload JSONB NOT NULL,
            received_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX idx_sync_runs_edition ON external_sync_runs(event_edition_id);
        CREATE INDEX idx_sync_runs_status ON external_sync_runs(status);

        ALTER TABLE external_sync_runs ENABLE ROW LEVEL SECURITY;
        ALTER TABLE external_raw_payloads ENABLE ROW LEVEL SECURITY;

        CREATE POLICY "Admins can view sync runs"
            ON external_sync_runs FOR ALL
            USING (
                EXISTS (
                    SELECT 1 FROM profiles
                    WHERE profiles.id = auth.uid()
                    AND (profiles.is_admin = true OR profiles.is_system_admin = true)
                )
            );
    END IF;
END $$;
