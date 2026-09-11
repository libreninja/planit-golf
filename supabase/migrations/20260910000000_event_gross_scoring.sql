-- Planit-owned scoring attached to existing editions and golfers. No GG
-- importer, existing public policy, or production fixture is changed here.
BEGIN;

ALTER TABLE public.event_participants
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN golfer_id UUID REFERENCES public.golfers(id),
  ADD CONSTRAINT event_participants_identity CHECK (user_id IS NOT NULL OR golfer_id IS NOT NULL),
  ADD CONSTRAINT event_participants_edition_golfer UNIQUE (event_edition_id, golfer_id),
  ADD CONSTRAINT event_participants_edition_id UNIQUE (id, event_edition_id),
  ADD CONSTRAINT event_participants_scoring_identity UNIQUE (id, event_edition_id, golfer_id);

CREATE TABLE public.event_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_edition_id UUID NOT NULL REFERENCES public.event_editions(id),
  round_number INTEGER NOT NULL CHECK (round_number > 0),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  course_name TEXT NOT NULL CHECK (btrim(course_name) <> ''),
  starts_on DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  counts_toward_competition BOOLEAN NOT NULL,
  score_authority TEXT NOT NULL CHECK (score_authority IN ('planit', 'golf_genius')),
  golf_genius_round_id TEXT CHECK (btrim(golf_genius_round_id) <> ''),
  CHECK (score_authority <> 'golf_genius' OR golf_genius_round_id IS NOT NULL),
  UNIQUE (event_edition_id, round_number),
  UNIQUE (event_edition_id, golf_genius_round_id),
  UNIQUE (id, event_edition_id)
);

-- Explicit played-hole set: supports nine/eighteen holes and shotgun starts.
-- No guessed course par or synthetic Golf Genius course identity.
CREATE TABLE public.event_round_holes (
  round_id UUID NOT NULL REFERENCES public.event_rounds(id),
  hole INTEGER NOT NULL CHECK (hole BETWEEN 1 AND 18),
  par INTEGER NOT NULL CHECK (par BETWEEN 3 AND 6),
  PRIMARY KEY (round_id, hole)
);

CREATE TABLE public.event_round_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_edition_id UUID NOT NULL,
  round_id UUID NOT NULL,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  starts_at TIMESTAMPTZ,
  starting_hole INTEGER,
  golf_genius_group_id TEXT CHECK (btrim(golf_genius_group_id) <> ''),
  FOREIGN KEY (round_id, event_edition_id) REFERENCES public.event_rounds(id, event_edition_id),
  FOREIGN KEY (round_id, starting_hole) REFERENCES public.event_round_holes(round_id, hole),
  UNIQUE (id, round_id, event_edition_id),
  UNIQUE (round_id, golf_genius_group_id)
);

-- Round participation precedes pairing. GG can publish an unassigned round
-- player without a tee time/group; do not fabricate scheduling facts for them.
CREATE TABLE public.event_round_participants (
  event_edition_id UUID NOT NULL,
  round_id UUID NOT NULL,
  group_id UUID,
  participant_id UUID NOT NULL,
  PRIMARY KEY (round_id, participant_id),
  FOREIGN KEY (round_id, event_edition_id) REFERENCES public.event_rounds(id, event_edition_id),
  FOREIGN KEY (group_id, round_id, event_edition_id)
    REFERENCES public.event_round_groups(id, round_id, event_edition_id),
  FOREIGN KEY (participant_id, event_edition_id)
    REFERENCES public.event_participants(id, event_edition_id)
);

-- Each row IS a scoring fact/revision, including the previous value. Current
-- score = highest revision for the round/participant/hole; totals are not stored.
-- No delete cascades: scored identity/context cannot silently disappear.
CREATE TABLE public.event_hole_score_revisions (
  request_id UUID PRIMARY KEY,
  event_edition_id UUID NOT NULL,
  round_id UUID NOT NULL,
  group_id UUID NOT NULL,
  participant_id UUID NOT NULL,
  golfer_id UUID NOT NULL,
  hole INTEGER NOT NULL,
  gross INTEGER NOT NULL CHECK (gross BETWEEN 1 AND 99),
  previous_gross INTEGER CHECK (previous_gross BETWEEN 1 AND 99),
  revision INTEGER NOT NULL CHECK (revision > 0),
  actor_ref TEXT NOT NULL CHECK (length(btrim(actor_ref)) BETWEEN 1 AND 200),
  source TEXT NOT NULL CHECK (source IN ('manual', 'voice', 'import')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (round_id, participant_id, hole, revision),
  FOREIGN KEY (round_id, participant_id)
    REFERENCES public.event_round_participants(round_id, participant_id),
  FOREIGN KEY (group_id, round_id, event_edition_id)
    REFERENCES public.event_round_groups(id, round_id, event_edition_id),
  FOREIGN KEY (participant_id, event_edition_id, golfer_id)
    REFERENCES public.event_participants(id, event_edition_id, golfer_id),
  FOREIGN KEY (round_id, hole) REFERENCES public.event_round_holes(round_id, hole)
);

ALTER TABLE public.event_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_round_holes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_round_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_round_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_hole_score_revisions ENABLE ROW LEVEL SECURITY;

-- Private service boundary only. Future public/signed-link surfaces must
-- establish their own authorization and curated read shape first.
REVOKE ALL ON public.event_rounds, public.event_round_holes,
  public.event_round_groups, public.event_round_participants,
  public.event_hole_score_revisions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_rounds,
  public.event_round_holes, public.event_round_groups,
  public.event_round_participants TO service_role;
GRANT SELECT ON public.event_hole_score_revisions TO service_role;

CREATE FUNCTION public.record_event_gross_score(
  p_event_edition_id UUID, p_round_id UUID, p_group_id UUID,
  p_participant_id UUID, p_hole INTEGER, p_gross INTEGER,
  p_expected_revision INTEGER, p_request_id UUID,
  p_actor_ref TEXT, p_source TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_golfer_id UUID;
  v_previous public.event_hole_score_revisions;
  v_result public.event_hole_score_revisions;
BEGIN
  IF p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 0 OR p_expected_revision = 2147483647
    OR p_hole IS NULL OR p_hole NOT BETWEEN 1 AND 18
    OR p_gross IS NULL OR p_gross NOT BETWEEN 1 AND 99
    OR p_actor_ref IS NULL OR length(btrim(p_actor_ref)) NOT BETWEEN 1 AND 200
    OR p_source IS NULL OR p_source NOT IN ('manual', 'voice', 'import') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid score input';
  END IF;

  -- Serialize a request key even if a buggy caller reuses it for another card.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  SELECT * INTO v_result FROM public.event_hole_score_revisions WHERE request_id = p_request_id;
  IF FOUND THEN
    IF v_result.event_edition_id IS DISTINCT FROM p_event_edition_id
      OR v_result.round_id IS DISTINCT FROM p_round_id
      OR v_result.group_id IS DISTINCT FROM p_group_id
      OR v_result.participant_id IS DISTINCT FROM p_participant_id
      OR v_result.hole <> p_hole OR v_result.gross <> p_gross
      OR v_result.revision <> p_expected_revision + 1
      OR v_result.actor_ref <> p_actor_ref OR v_result.source <> p_source THEN
      RAISE EXCEPTION USING ERRCODE = 'P1003', MESSAGE = 'request id already used for another score command';
    END IF;
    -- A retry returns its original receipt, even after a later correction or
    -- round closure. This does not write or claim to return the current score.
    RETURN to_jsonb(v_result);
  END IF;

  -- Lock membership to serialize competing edits (including a first score).
  -- Share locks prevent concurrent context changes until the fact is written.
  SELECT p.golfer_id INTO v_golfer_id
  FROM public.event_editions e
  JOIN public.event_rounds r ON r.event_edition_id = e.id
  JOIN public.event_round_groups g ON g.round_id = r.id AND g.event_edition_id = e.id
  JOIN public.event_round_participants m ON m.group_id = g.id AND m.round_id = r.id
  JOIN public.event_participants p ON p.id = m.participant_id AND p.event_edition_id = e.id
  JOIN public.event_round_holes h ON h.round_id = r.id AND h.hole = p_hole
  WHERE e.id = p_event_edition_id AND r.id = p_round_id AND g.id = p_group_id
    AND p.id = p_participant_id AND p.golfer_id IS NOT NULL
    AND p.participant_type = 'player' AND p.status IN ('registered', 'confirmed')
    AND r.score_authority = 'planit' AND e.status = 'active' AND r.status = 'open'
  FOR SHARE OF e, r, g, p, h FOR UPDATE OF m;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P1001', MESSAGE = 'invalid or closed event scoring context';
  END IF;

  SELECT * INTO v_previous FROM public.event_hole_score_revisions
  WHERE round_id = p_round_id AND participant_id = p_participant_id AND hole = p_hole
  ORDER BY revision DESC LIMIT 1;
  IF COALESCE(v_previous.revision, 0) <> p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE = 'P1002', MESSAGE = 'score changed; read current revision before correcting';
  END IF;

  INSERT INTO public.event_hole_score_revisions (
    request_id, event_edition_id, round_id, group_id, participant_id, golfer_id,
    hole, gross, previous_gross, revision, actor_ref, source
  ) VALUES (
    p_request_id, p_event_edition_id, p_round_id, p_group_id, p_participant_id, v_golfer_id,
    p_hole, p_gross, v_previous.gross, p_expected_revision + 1, p_actor_ref, p_source
  ) RETURNING * INTO v_result;
  RETURN to_jsonb(v_result);
END;
$$;

-- One SQL statement gives a consistent edition snapshot; errors never become
-- empty event state. This is a trusted service read, not a public DTO.
CREATE FUNCTION public.read_event_scoring_state(p_event_edition_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'edition', jsonb_build_object('id', e.id, 'seriesSlug', s.slug, 'name', s.name,
      'year', e.year, 'status', e.status, 'visibility', e.visibility,
      'startsOn', e.starts_on, 'endsOn', e.ends_on, 'locationName', e.location_name,
      'golfGeniusEventId', e.golf_genius_event_id),
    'participants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'golferId', p.golfer_id,
        'name', g.display_name, 'type', p.participant_type, 'status', p.status) ORDER BY p.id)
      FROM public.event_participants p LEFT JOIN public.golfers g ON g.id = p.golfer_id
      WHERE p.event_edition_id = e.id
    ), '[]'::jsonb),
    'rounds', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', r.id, 'number', r.round_number,
        'name', r.name, 'courseName', r.course_name, 'startsOn', r.starts_on,
        'status', r.status, 'countsTowardCompetition', r.counts_toward_competition,
        'scoreAuthority', r.score_authority, 'golfGeniusRoundId', r.golf_genius_round_id,
        'participantIds', COALESCE((SELECT jsonb_agg(m.participant_id ORDER BY m.participant_id)
          FROM public.event_round_participants m WHERE m.round_id = r.id), '[]'::jsonb),
        'holes', COALESCE((SELECT jsonb_agg(jsonb_build_object('hole', h.hole, 'par', h.par) ORDER BY h.hole)
          FROM public.event_round_holes h WHERE h.round_id = r.id), '[]'::jsonb),
        'groups', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name,
          'startsAt', g.starts_at, 'startingHole', g.starting_hole,
          'golfGeniusGroupId', g.golf_genius_group_id,
          'participantIds', COALESCE((SELECT jsonb_agg(m.participant_id ORDER BY m.participant_id)
            FROM public.event_round_participants m WHERE m.group_id = g.id), '[]'::jsonb)
          ) ORDER BY g.starts_at, g.id)
          FROM public.event_round_groups g WHERE g.round_id = r.id), '[]'::jsonb)
        ) ORDER BY r.round_number)
      FROM public.event_rounds r WHERE r.event_edition_id = e.id
    ), '[]'::jsonb),
    'scores', COALESCE((SELECT jsonb_agg(to_jsonb(latest) ORDER BY latest.round_id, latest.participant_id, latest.hole)
      FROM (SELECT DISTINCT ON (v.round_id, v.participant_id, v.hole) v.*
        FROM public.event_hole_score_revisions v WHERE v.event_edition_id = e.id
        ORDER BY v.round_id, v.participant_id, v.hole, v.revision DESC) latest
    ), '[]'::jsonb)
  ) FROM public.event_editions e JOIN public.event_series s ON s.id = e.event_series_id
  WHERE e.id = p_event_edition_id;
$$;

REVOKE ALL ON FUNCTION public.record_event_gross_score(UUID, UUID, UUID, UUID, INTEGER, INTEGER, INTEGER, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_event_scoring_state(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_event_gross_score(UUID, UUID, UUID, UUID, INTEGER, INTEGER, INTEGER, UUID, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.read_event_scoring_state(UUID) TO service_role;

COMMIT;
