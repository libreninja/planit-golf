-- Lightweight durable activity feed for PlanIt. V1 is Seattle Cup scouting only:
-- a compact, per-user-unread activity inbox in the authenticated app shell.
--
-- planit.golf OWNS this layer (user-facing activity + unread state + realtime
-- delivery). The authoritative scouting domain state (candidate state,
-- availability, notes) stays in the planit-ai project; activity_events is an
-- audit/notification projection authored at the planit.golf Server Action choke
-- point AFTER a successful planit-ai write. It is NOT a second source of
-- candidate state / availability / notes — it records who changed what, for an
-- inbox, nothing more.
--
-- The envelope is intentionally generic (feature + activity_type + subject) so
-- future league / trips / events / roster activity can reuse it without an event
-- bus or notification framework. Only seattle_cup_scouting activity is produced
-- in V1, and activity_type is CHECK-constrained to the three approved types.

-- ---------------------------------------------------------------------------
-- Entitlement helper (defined first; the activity_events SELECT policy uses it).
-- Mirrors lib/scouting-access.hasScoutingAccess: an active seattle_cup_scouting
-- entitlement for the user. SECURITY DEFINER so it can read feature_entitlements
-- rows for ANY user (the user's own SELECT policy only exposes their own rows).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_scouting_entitlement(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.feature_entitlements
    WHERE user_id = p_user_id
      AND feature_key = 'seattle_cup_scouting'
      AND status = 'active'
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_scouting_entitlement(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- activity_events: append-only activity feed. Author + meaningful action +
-- subject player (cross-database — the player lives in planit-ai, so no FK).
-- ---------------------------------------------------------------------------
CREATE TABLE public.activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The PlanIt user who made the change. Denormalized display name so the inbox
  -- renders "Noah …" without a join; the authoritative actor identity is the
  -- user_id (FK to auth.users).
  actor_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_display_name TEXT NOT NULL,
  feature TEXT NOT NULL,
  activity_type TEXT NOT NULL CHECK (
    activity_type IN ('note_added', 'candidate_state_changed', 'availability_changed')
  ),
  -- A planit-ai player id (stored as text — cross-database, no FK here). NULL
  -- only if a future activity type has no player subject; V1 always sets it.
  subject_player_id TEXT,
  subject_player_name TEXT,
  -- Structured, render-hinting metadata only. NOT authoritative domain state.
  -- candidate_state_changed: { from_state, to_state }
  -- availability_changed: { session_id, session_label, status, cleared }
  -- note_added:          { note_id, preview }
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX activity_events_feature_created_idx
  ON public.activity_events (feature, created_at DESC);

ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

-- Only users with an ACTIVE seattle_cup_scouting entitlement may read scouting
-- activity. Supabase Realtime postgres_changes respects this SELECT policy, so
-- a non-entitled browser receives no events. All writes go through the
-- service-role client (server-side, in the planit.golf Server Actions), so there
-- are NO user INSERT / UPDATE / DELETE policies — RLS denies user writes by
-- default.
CREATE POLICY "Scouting captains read scouting activity"
  ON public.activity_events FOR SELECT
  USING (public.has_scouting_entitlement(auth.uid()));

-- ---------------------------------------------------------------------------
-- activity_read_state: per-user, per-feature "last seen activity" boundary.
-- Unread for a feature = activity_events.created_at > last_seen_at. No per-item
-- read receipts. The composite key supports multiple future features.
-- ---------------------------------------------------------------------------
CREATE TABLE public.activity_read_state (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, feature)
);

ALTER TABLE public.activity_read_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own read-state"
  ON public.activity_read_state FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own read-state"
  ON public.activity_read_state FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own read-state"
  ON public.activity_read_state FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Realtime: publish activity_events changes to subscribed browsers. Only
-- INSERTs occur in V1 (append-only); the table has a PK so the default
-- REPLICA IDENTITY is sufficient for the INSERT events RLS-scoped clients
-- receive. Guarded so re-running the migration is a no-op.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'activity_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_events;
  END IF;
END $$;