-- Player Detail V1 + private follow capture.
--
-- A Planit golfer is independent from auth.users. Golf Genius identifiers are
-- evidence attached to that golfer, scoped to the competition season in which
-- Planit observed them; they are never the Planit primary key. The initial
-- resolver is deliberately conservative for the only supported analytics
-- scope: the 2026 IGC Men's League.

CREATE TABLE public.golfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL CHECK (btrim(display_name) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.golfer_external_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  golfer_id UUID REFERENCES public.golfers(id) ON DELETE SET NULL,
  source_system TEXT NOT NULL CHECK (source_system IN ('golf_genius')),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('competition_season')),
  scope_key TEXT NOT NULL,
  external_id TEXT NOT NULL CHECK (btrim(external_id) <> ''),
  display_name_snapshot TEXT,
  resolution_status TEXT NOT NULL CHECK (resolution_status IN ('resolved', 'unresolved')),
  resolution_reason TEXT NOT NULL,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_system, scope_type, scope_key, external_id),
  CHECK (
    (resolution_status = 'resolved' AND golfer_id IS NOT NULL)
    OR (resolution_status = 'unresolved' AND golfer_id IS NULL)
  )
);

CREATE INDEX golfer_external_identities_golfer_idx
  ON public.golfer_external_identities(golfer_id)
  WHERE golfer_id IS NOT NULL;

-- Optional, explicit self-link. V1 does not infer this from names or from the
-- legacy members sync (which currently joins rosters by normalized name).
CREATE TABLE public.golfer_user_links (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  golfer_id UUID NOT NULL UNIQUE REFERENCES public.golfers(id) ON DELETE CASCADE,
  link_method TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.golfer_follows (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  golfer_id UUID NOT NULL REFERENCES public.golfers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, golfer_id)
);

CREATE INDEX golfer_follows_golfer_idx ON public.golfer_follows(golfer_id);

ALTER TABLE public.golfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.golfer_external_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.golfer_user_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.golfer_follows ENABLE ROW LEVEL SECURITY;

-- Player records and their already-public GG evidence back a public league
-- result surface. Follow rows and auth links remain private to their owner.
CREATE POLICY "Public can view golfers"
  ON public.golfers FOR SELECT USING (true);

CREATE POLICY "Public can view golfer identity evidence"
  ON public.golfer_external_identities FOR SELECT USING (true);

CREATE POLICY "Users view their own golfer link"
  ON public.golfer_user_links FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users view their own golfer follows"
  ON public.golfer_follows FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users follow as themselves"
  ON public.golfer_follows FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users unfollow as themselves"
  ON public.golfer_follows FOR DELETE
  USING (user_id = auth.uid());

-- Defense in depth for direct API writes: an unresolved/orphan golfer cannot
-- be followed, and a verified self-link cannot follow itself.
CREATE OR REPLACE FUNCTION public.validate_golfer_follow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.golfer_external_identities e
    WHERE e.golfer_id = NEW.golfer_id
      AND e.resolution_status = 'resolved'
  ) THEN
    RAISE EXCEPTION 'unresolved golfer cannot be followed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.golfer_user_links l
    WHERE l.user_id = NEW.user_id
      AND l.golfer_id = NEW.golfer_id
  ) THEN
    RAISE EXCEPTION 'a golfer cannot follow themselves';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_golfer_follow_before_insert
  BEFORE INSERT ON public.golfer_follows
  FOR EACH ROW EXECUTE FUNCTION public.validate_golfer_follow();

-- Reconcile scoped GG evidence after a finalized league import. A card is
-- resolved only when every 2026 Men's appearance for that scoped card has the
-- same exact normalized display name and none looks like a generic guest slot.
-- Names are negative/conflict evidence only: the resolver never joins two
-- cards because their names happen to match.
CREATE OR REPLACE FUNCTION public.refresh_igc_2026_mens_golfer_identities(
  p_external_ids TEXT[] DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_external_id TEXT;
  v_names TEXT[];
  v_display_name TEXT;
  v_existing_golfer_id UUID;
  v_golfer_id UUID;
  v_reason TEXT;
  v_resolved BOOLEAN;
  v_count INTEGER := 0;
BEGIN
  FOR v_external_id IN
    SELECT DISTINCT observed.external_id
    FROM (
      SELECT p.member_card_id AS external_id
      FROM public.igc_league_performances p
      WHERE p.league_key = 'mens'
        AND p.event_date >= DATE '2026-01-01'
        AND p.event_date < DATE '2027-01-01'
        AND p.member_card_id IS NOT NULL
      UNION
      SELECT r.member_card_id
      FROM public.igc_league_results r
      JOIN public.igc_league_events e ON e.id = r.event_id
      WHERE r.league_key = 'mens'
        AND e.event_date >= DATE '2026-01-01'
        AND e.event_date < DATE '2027-01-01'
        AND r.member_card_id IS NOT NULL
    ) observed
    WHERE p_external_ids IS NULL OR observed.external_id = ANY(p_external_ids)
  LOOP
    -- Serialize resolution for one external key so parallel gross/net imports
    -- cannot create two Planit golfers for the same scoped evidence.
    PERFORM pg_advisory_xact_lock(hashtextextended('igc-mens-2026:' || v_external_id, 0));

    SELECT
      array_agg(DISTINCT observed.normalized_name ORDER BY observed.normalized_name),
      max(observed.display_name)
    INTO v_names, v_display_name
    FROM (
      SELECT
        regexp_replace(lower(btrim(p.player_name)), '\s+', ' ', 'g') AS normalized_name,
        btrim(p.player_name) AS display_name
      FROM public.igc_league_performances p
      WHERE p.league_key = 'mens'
        AND p.event_date >= DATE '2026-01-01'
        AND p.event_date < DATE '2027-01-01'
        AND p.member_card_id = v_external_id
      UNION ALL
      SELECT
        regexp_replace(lower(btrim(r.player_name)), '\s+', ' ', 'g'),
        btrim(r.player_name)
      FROM public.igc_league_results r
      JOIN public.igc_league_events e ON e.id = r.event_id
      WHERE r.league_key = 'mens'
        AND e.event_date >= DATE '2026-01-01'
        AND e.event_date < DATE '2027-01-01'
        AND r.member_card_id = v_external_id
    ) observed
    WHERE observed.normalized_name <> '';

    v_resolved := COALESCE(array_length(v_names, 1), 0) = 1
      AND v_names[1] !~ '(^|[^a-z])(guest|tbd|unknown|walk.?in|player[[:space:]]*[0-9]+)([^a-z]|$)';
    v_reason := CASE
      WHEN COALESCE(array_length(v_names, 1), 0) = 0 THEN 'missing_display_name'
      WHEN array_length(v_names, 1) > 1 THEN 'ambiguous_display_names'
      WHEN NOT v_resolved THEN 'generic_guest_slot'
      ELSE 'unique_scoped_member_card'
    END;

    SELECT golfer_id
    INTO v_existing_golfer_id
    FROM public.golfer_external_identities
    WHERE source_system = 'golf_genius'
      AND scope_type = 'competition_season'
      AND scope_key = 'igc-mens-2026'
      AND external_id = v_external_id
    FOR UPDATE;

    IF v_resolved THEN
      v_golfer_id := v_existing_golfer_id;
      IF v_golfer_id IS NULL THEN
        INSERT INTO public.golfers(display_name)
        VALUES (v_display_name)
        RETURNING id INTO v_golfer_id;
      ELSE
        UPDATE public.golfers
        SET display_name = v_display_name, updated_at = NOW()
        WHERE id = v_golfer_id;
      END IF;
    ELSE
      v_golfer_id := NULL;
    END IF;

    INSERT INTO public.golfer_external_identities(
      golfer_id, source_system, scope_type, scope_key, external_id,
      display_name_snapshot, resolution_status, resolution_reason,
      provenance, first_observed_at, last_observed_at
    ) VALUES (
      v_golfer_id, 'golf_genius', 'competition_season', 'igc-mens-2026', v_external_id,
      v_display_name, CASE WHEN v_resolved THEN 'resolved' ELSE 'unresolved' END,
      v_reason,
      jsonb_build_object(
        'league', 'mens',
        'season', 2026,
        'evidence', 'persisted Golf Genius performance/result member_card_id',
        'normalized_names', to_jsonb(COALESCE(v_names, ARRAY[]::TEXT[]))
      ),
      NOW(), NOW()
    )
    ON CONFLICT (source_system, scope_type, scope_key, external_id)
    DO UPDATE SET
      golfer_id = EXCLUDED.golfer_id,
      display_name_snapshot = EXCLUDED.display_name_snapshot,
      resolution_status = EXCLUDED.resolution_status,
      resolution_reason = EXCLUDED.resolution_reason,
      provenance = EXCLUDED.provenance,
      last_observed_at = NOW();

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Seed only from current 2026 persisted appearances. Scheduled roster-only
-- entries do not become people, and ambiguous/shared cards remain unresolved.
SELECT public.refresh_igc_2026_mens_golfer_identities(NULL);

-- Supabase grants table privileges separately from RLS. Keep the public result
-- evidence readable, while limiting user-owned relations to their documented
-- operations and all canonical writes to the service role/reconcile path.
REVOKE ALL ON TABLE public.golfers FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.golfer_external_identities FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.golfer_user_links FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.golfer_follows FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.golfers TO anon, authenticated;
GRANT SELECT ON TABLE public.golfer_external_identities TO anon, authenticated;
GRANT SELECT ON TABLE public.golfer_user_links TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.golfer_follows TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.golfers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.golfer_external_identities TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.golfer_user_links TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.golfer_follows TO service_role;

REVOKE ALL ON FUNCTION public.refresh_igc_2026_mens_golfer_identities(TEXT[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_golfer_follow()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_igc_2026_mens_golfer_identities(TEXT[]) TO service_role;
