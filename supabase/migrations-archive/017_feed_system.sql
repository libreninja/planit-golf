-- Feed events (polymorphic activity)
CREATE TABLE feed_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_type TEXT NOT NULL CHECK (subject_type IN ('event_edition', 'club', 'trip', 'user')),
    subject_id UUID NOT NULL,
    actor_type TEXT DEFAULT 'system' CHECK (actor_type IN ('system', 'user', 'external_sync')),
    actor_id UUID REFERENCES auth.users(id),
    type TEXT NOT NULL, -- standings_updated, pairings_posted, registration_closes, etc.
    data JSONB DEFAULT '{}',
    visibility TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'club_members', 'participants', 'admins')),
    dedupe_key TEXT, -- prevent duplicates: "standings_updated:seattle-cup:2026:r2"
    is_pinned BOOLEAN DEFAULT false,
    is_hidden BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Feed reactions
CREATE TABLE feed_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feed_event_id UUID NOT NULL REFERENCES feed_events(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    reaction_type TEXT NOT NULL, -- emoji slug
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(feed_event_id, user_id, reaction_type)
);

-- Indexes for performance
CREATE INDEX idx_feed_events_subject ON feed_events(subject_type, subject_id);
CREATE INDEX idx_feed_events_created ON feed_events(created_at DESC);
CREATE INDEX idx_feed_events_dedupe ON feed_events(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX idx_feed_events_pinned ON feed_events(is_pinned) WHERE is_pinned = true;

-- RLS Policies
ALTER TABLE feed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_reactions ENABLE ROW LEVEL SECURITY;

-- Feed events: public can view public events
CREATE POLICY "Public can view public feed events"
    ON feed_events FOR SELECT
    USING (visibility = 'public' AND is_hidden = false);

-- Feed reactions: users manage their own
CREATE POLICY "Users manage their reactions"
    ON feed_reactions FOR ALL
    USING (user_id = auth.uid());
