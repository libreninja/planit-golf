-- IGC event companion shell.
-- Golf Genius remains the system of record; these tables store read-only imports
-- plus Planit-specific context and event memory.

CREATE TABLE IF NOT EXISTS public.communities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  short_name TEXT,
  description TEXT,
  brand_color TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_communities_updated_at ON public.communities;
CREATE TRIGGER update_communities_updated_at
  BEFORE UPDATE ON public.communities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "communities_select_all" ON public.communities;
CREATE POLICY "communities_select_all" ON public.communities FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.igc_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  location_name TEXT,
  starts_on DATE,
  ends_on DATE,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('draft', 'scheduled', 'active', 'completed', 'cancelled')),
  golf_genius_event_id TEXT,
  golf_genius_portal_id TEXT,
  golf_genius_portal_url TEXT,
  logistics JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_igc_events_updated_at ON public.igc_events;
CREATE TRIGGER update_igc_events_updated_at
  BEFORE UPDATE ON public.igc_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS igc_events_community_id_idx ON public.igc_events (community_id);
CREATE INDEX IF NOT EXISTS igc_events_starts_on_idx ON public.igc_events (starts_on);
CREATE INDEX IF NOT EXISTS igc_events_golf_genius_event_id_idx
  ON public.igc_events (golf_genius_event_id)
  WHERE golf_genius_event_id IS NOT NULL;

ALTER TABLE public.igc_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "igc_events_select_all" ON public.igc_events;
CREATE POLICY "igc_events_select_all" ON public.igc_events FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.igc_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.igc_events(id) ON DELETE CASCADE,
  external_player_id TEXT NOT NULL,
  external_member_id TEXT,
  display_name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  handicap_index NUMERIC,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, external_player_id)
);

DROP TRIGGER IF EXISTS update_igc_players_updated_at ON public.igc_players;
CREATE TRIGGER update_igc_players_updated_at
  BEFORE UPDATE ON public.igc_players
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS igc_players_event_id_idx ON public.igc_players (event_id);
ALTER TABLE public.igc_players ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "igc_players_select_all" ON public.igc_players;
CREATE POLICY "igc_players_select_all" ON public.igc_players FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.igc_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.igc_events(id) ON DELETE CASCADE,
  external_round_id TEXT NOT NULL,
  name TEXT NOT NULL,
  round_number INT,
  course_name TEXT,
  starts_on DATE,
  status TEXT,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, external_round_id)
);

DROP TRIGGER IF EXISTS update_igc_rounds_updated_at ON public.igc_rounds;
CREATE TRIGGER update_igc_rounds_updated_at
  BEFORE UPDATE ON public.igc_rounds
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS igc_rounds_event_id_idx ON public.igc_rounds (event_id);
ALTER TABLE public.igc_rounds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "igc_rounds_select_all" ON public.igc_rounds;
CREATE POLICY "igc_rounds_select_all" ON public.igc_rounds FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.igc_tee_times (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.igc_events(id) ON DELETE CASCADE,
  round_id UUID REFERENCES public.igc_rounds(id) ON DELETE CASCADE,
  external_tee_time_id TEXT NOT NULL,
  tee_time_label TEXT,
  starts_at TIMESTAMPTZ,
  tee TEXT,
  group_name TEXT,
  display_order INT NOT NULL DEFAULT 0,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, external_tee_time_id)
);

DROP TRIGGER IF EXISTS update_igc_tee_times_updated_at ON public.igc_tee_times;
CREATE TRIGGER update_igc_tee_times_updated_at
  BEFORE UPDATE ON public.igc_tee_times
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS igc_tee_times_event_round_idx ON public.igc_tee_times (event_id, round_id, display_order);
ALTER TABLE public.igc_tee_times ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "igc_tee_times_select_all" ON public.igc_tee_times;
CREATE POLICY "igc_tee_times_select_all" ON public.igc_tee_times FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.igc_pairings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.igc_events(id) ON DELETE CASCADE,
  round_id UUID REFERENCES public.igc_rounds(id) ON DELETE CASCADE,
  tee_time_id UUID REFERENCES public.igc_tee_times(id) ON DELETE CASCADE,
  external_pairing_id TEXT NOT NULL,
  external_player_id TEXT,
  player_name TEXT NOT NULL,
  team_name TEXT,
  display_order INT NOT NULL DEFAULT 0,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, external_pairing_id)
);

DROP TRIGGER IF EXISTS update_igc_pairings_updated_at ON public.igc_pairings;
CREATE TRIGGER update_igc_pairings_updated_at
  BEFORE UPDATE ON public.igc_pairings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS igc_pairings_tee_time_id_idx ON public.igc_pairings (tee_time_id, display_order);
ALTER TABLE public.igc_pairings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "igc_pairings_select_all" ON public.igc_pairings;
CREATE POLICY "igc_pairings_select_all" ON public.igc_pairings FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.external_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  external_id TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS external_sync_runs_entity_idx
  ON public.external_sync_runs (provider, entity_type, entity_id, started_at DESC);

ALTER TABLE public.external_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.external_raw_payloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id UUID NOT NULL REFERENCES public.external_sync_runs(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status_code INT,
  ok BOOLEAN NOT NULL DEFAULT false,
  payload JSONB,
  error_message TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS external_raw_payloads_sync_run_id_idx
  ON public.external_raw_payloads (sync_run_id, fetched_at);

ALTER TABLE public.external_raw_payloads ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.igc_leaderboard_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.igc_events(id) ON DELETE CASCADE,
  round_id UUID REFERENCES public.igc_rounds(id) ON DELETE SET NULL,
  external_sync_run_id UUID REFERENCES public.external_sync_runs(id) ON DELETE SET NULL,
  source_payload_id UUID REFERENCES public.external_raw_payloads(id) ON DELETE SET NULL,
  leaderboard_type TEXT NOT NULL DEFAULT 'event',
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  content_hash TEXT NOT NULL,
  rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, round_id, leaderboard_type, content_hash)
);

CREATE INDEX IF NOT EXISTS igc_leaderboard_snapshots_event_idx
  ON public.igc_leaderboard_snapshots (event_id, snapshot_at DESC);

ALTER TABLE public.igc_leaderboard_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "igc_leaderboard_snapshots_select_all" ON public.igc_leaderboard_snapshots;
CREATE POLICY "igc_leaderboard_snapshots_select_all" ON public.igc_leaderboard_snapshots FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.igc_feed_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.igc_events(id) ON DELETE CASCADE,
  external_sync_run_id UUID REFERENCES public.external_sync_runs(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dedupe_key TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS igc_feed_events_event_idx
  ON public.igc_feed_events (event_id, occurred_at DESC);

ALTER TABLE public.igc_feed_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "igc_feed_events_select_all" ON public.igc_feed_events;
CREATE POLICY "igc_feed_events_select_all" ON public.igc_feed_events FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.igc_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_event_id UUID NOT NULL REFERENCES public.igc_feed_events(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_igc_comments_updated_at ON public.igc_comments;
CREATE TRIGGER update_igc_comments_updated_at
  BEFORE UPDATE ON public.igc_comments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.igc_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "igc_comments_select_all" ON public.igc_comments;
CREATE POLICY "igc_comments_select_all" ON public.igc_comments FOR SELECT USING (true);
DROP POLICY IF EXISTS "igc_comments_insert_authenticated" ON public.igc_comments;
CREATE POLICY "igc_comments_insert_authenticated" ON public.igc_comments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.igc_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_event_id UUID NOT NULL REFERENCES public.igc_feed_events(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reaction TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(feed_event_id, user_id, reaction)
);

ALTER TABLE public.igc_reactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "igc_reactions_select_all" ON public.igc_reactions;
CREATE POLICY "igc_reactions_select_all" ON public.igc_reactions FOR SELECT USING (true);
DROP POLICY IF EXISTS "igc_reactions_insert_authenticated" ON public.igc_reactions;
CREATE POLICY "igc_reactions_insert_authenticated" ON public.igc_reactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

WITH community AS (
  INSERT INTO public.communities (slug, name, short_name, description, brand_color)
  VALUES (
    'interbay-golf-club',
    'Interbay Golf Club',
    'IGC',
    'The Interbay Golf Club community hub on planit.golf.',
    '#2f7d4f'
  )
  ON CONFLICT (slug) DO UPDATE
  SET
    name = EXCLUDED.name,
    short_name = EXCLUDED.short_name,
    description = EXCLUDED.description,
    brand_color = EXCLUDED.brand_color,
    updated_at = NOW()
  RETURNING id
)
INSERT INTO public.igc_events (
  community_id,
  slug,
  name,
  description,
  location_name,
  starts_on,
  status,
  logistics
)
SELECT
  community.id,
  'upcoming-igc-event',
  'Upcoming IGC Event',
  'A Golf Genius-powered event companion for the next Interbay Golf Club trip.',
  'Interbay Golf Center',
  DATE '2026-05-30',
  'scheduled',
  jsonb_build_object(
    'lodging', '',
    'itinerary', jsonb_build_array(),
    'dinner', '',
    'transportation', '',
    'usefulLinks', jsonb_build_array(),
    'announcements', jsonb_build_array()
  )
FROM community
ON CONFLICT (slug) DO NOTHING;
