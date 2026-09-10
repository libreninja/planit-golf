BEGIN;

-- Opaque capability, never an account or upstream credential. Only its digest
-- persists. Scope is immutable; replacement access requires a new capability.
CREATE TABLE public.event_scorecard_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  event_edition_id UUID NOT NULL,
  round_id UUID NOT NULL,
  group_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (expires_at > created_at),
  FOREIGN KEY (group_id, round_id, event_edition_id)
    REFERENCES public.event_round_groups(id, round_id, event_edition_id)
);
ALTER TABLE public.event_scorecard_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_scorecard_access FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.issue_event_scorecard_access(
  p_token_hash TEXT, p_event_edition_id UUID, p_round_id UUID, p_group_id UUID, p_expires_at TIMESTAMPTZ
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_round_groups g
    JOIN public.event_rounds r ON r.id = g.round_id
    JOIN public.event_editions e ON e.id = r.event_edition_id
    JOIN public.event_series s ON s.id = e.event_series_id
    WHERE g.id = p_group_id AND r.id = p_round_id AND e.id = p_event_edition_id
      AND s.slug = 'wine-valley' AND e.status = 'active' AND r.status = 'open'
      AND r.score_authority = 'planit' AND r.source_active AND g.source_active
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P1001', MESSAGE = 'invalid scorecard context';
  END IF;
  INSERT INTO public.event_scorecard_access(token_hash, event_edition_id, round_id, group_id, expires_at)
  VALUES (p_token_hash, p_event_edition_id, p_round_id, p_group_id, p_expires_at) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.revoke_event_scorecard_access(p_access_id UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.event_scorecard_access SET revoked_at = clock_timestamp()
  WHERE id = p_access_id AND revoked_at IS NULL;
$$;

-- Hold a share lock until the read/write transaction ends. Revocation waits
-- for already-authorized operations; after revoke returns no new operation can
-- succeed. Not exposed even to service_role: only the adapters below call it.
CREATE FUNCTION public.authorize_event_scorecard(p_token_hash TEXT)
RETURNS public.event_scorecard_access LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_access public.event_scorecard_access;
BEGIN
  SELECT * INTO v_access FROM public.event_scorecard_access
  WHERE token_hash = p_token_hash FOR SHARE;
  IF NOT FOUND OR v_access.revoked_at IS NOT NULL OR v_access.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE = 'P1010', MESSAGE = 'scorecard link unavailable';
  END IF;
  PERFORM 1 FROM public.event_round_groups g
    JOIN public.event_rounds r ON r.id = g.round_id
    JOIN public.event_editions e ON e.id = r.event_edition_id
    WHERE g.id = v_access.group_id AND r.id = v_access.round_id AND e.id = v_access.event_edition_id
      AND g.source_active AND r.source_active AND r.score_authority = 'planit'
      AND e.status = 'active' AND r.status = 'open'
    FOR SHARE OF g, r, e;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P1010', MESSAGE = 'scorecard link unavailable';
  END IF;
  RETURN v_access;
END;
$$;

CREATE FUNCTION public.read_participant_scorecard(p_token_hash TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.event_scorecard_access; result JSONB;
BEGIN
  a := public.authorize_event_scorecard(p_token_hash);
  -- Curated group-only DTO: no roster references, other groups, account IDs,
  -- capability digest, or event-wide provenance leaves this boundary.
  SELECT jsonb_build_object(
    'eventEditionId', e.id, 'eventName', s.name,
    'roundId', r.id, 'roundName', r.name, 'startsOn', r.starts_on,
    'groupId', g.id, 'startsAt', g.starts_at, 'startingHole', g.starting_hole,
    'holes', (SELECT jsonb_agg(jsonb_build_object('hole', h.hole, 'par', h.par) ORDER BY h.hole)
      FROM public.event_round_holes h WHERE h.round_id = r.id),
    'players', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', golfer.display_name) ORDER BY golfer.display_name, p.id)
      FROM public.event_round_participants m
      JOIN public.event_participants p ON p.id = m.participant_id
      JOIN public.golfers golfer ON golfer.id = p.golfer_id
      WHERE m.round_id = r.id AND m.group_id = g.id AND m.source_active
        AND p.participant_type = 'player' AND p.status IN ('registered', 'confirmed')), '[]'::jsonb),
    'scores', COALESCE((SELECT jsonb_agg(jsonb_build_object('participantId', v.participant_id,
      'hole', v.hole, 'gross', v.gross, 'revision', v.revision, 'recordedAt', v.recorded_at))
      FROM (SELECT DISTINCT ON (score.participant_id, score.hole) score.*
        FROM public.event_hole_score_revisions score
        JOIN public.event_round_participants m ON m.round_id = score.round_id AND m.participant_id = score.participant_id
        JOIN public.event_participants p ON p.id = m.participant_id
        WHERE score.round_id = r.id AND m.group_id = g.id AND m.source_active
          AND p.participant_type = 'player' AND p.status IN ('registered', 'confirmed')
        ORDER BY score.participant_id, score.hole, score.revision DESC) v), '[]'::jsonb)
  ) INTO result FROM public.event_round_groups g
    JOIN public.event_rounds r ON r.id = g.round_id
    JOIN public.event_editions e ON e.id = r.event_edition_id
    JOIN public.event_series s ON s.id = e.event_series_id WHERE g.id = a.group_id;
  RETURN result;
END;
$$;

CREATE FUNCTION public.record_participant_gross_score(
  p_token_hash TEXT, p_event_edition_id UUID, p_round_id UUID, p_group_id UUID,
  p_participant_id UUID, p_hole INTEGER, p_gross INTEGER, p_expected_revision INTEGER, p_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.event_scorecard_access;
BEGIN
  a := public.authorize_event_scorecard(p_token_hash);
  IF a.event_edition_id IS DISTINCT FROM p_event_edition_id OR a.round_id IS DISTINCT FROM p_round_id
    OR a.group_id IS DISTINCT FROM p_group_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P1011', MESSAGE = 'outside scorecard scope';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  PERFORM 1 FROM public.event_round_participants m
    WHERE m.round_id = a.round_id AND m.group_id = a.group_id
      AND m.participant_id = p_participant_id AND m.source_active FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P1011', MESSAGE = 'outside scorecard scope';
  END IF;
  -- The existing deterministic operation remains the sole score writer.
  RETURN public.record_event_gross_score(p_event_edition_id, p_round_id, p_group_id,
    p_participant_id, p_hole, p_gross, p_expected_revision, p_request_id,
    'scorecard:' || a.id::text, 'manual');
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_event_scorecard(TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.issue_event_scorecard_access(TEXT, UUID, UUID, UUID, TIMESTAMPTZ),
  public.revoke_event_scorecard_access(UUID), public.read_participant_scorecard(TEXT),
  public.record_participant_gross_score(TEXT, UUID, UUID, UUID, UUID, INTEGER, INTEGER, INTEGER, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_event_scorecard_access(TEXT, UUID, UUID, UUID, TIMESTAMPTZ),
  public.revoke_event_scorecard_access(UUID), public.read_participant_scorecard(TEXT),
  public.record_participant_gross_score(TEXT, UUID, UUID, UUID, UUID, INTEGER, INTEGER, INTEGER, UUID)
  TO service_role;
COMMIT;
