-- Idempotent, metadata-only Golf Genius reconciliation for native event scoring.
-- GG owns captured roster/schedule/group facts. Planit owns purpose, competition
-- inclusion, score authority and every row in event_hole_score_revisions.
BEGIN;

ALTER TABLE public.event_editions
  ADD COLUMN golf_genius_portal_id TEXT CHECK (btrim(golf_genius_portal_id) <> '');

-- Event roster identity is private operational context. Do not put it in the
-- existing publicly-readable canonical evidence table.
CREATE TABLE public.event_participant_golf_genius_refs (
  event_edition_id UUID NOT NULL,
  participant_id UUID NOT NULL,
  event_id TEXT NOT NULL CHECK (btrim(event_id) <> ''),
  roster_id TEXT NOT NULL CHECK (btrim(roster_id) <> ''),
  member_card_id TEXT NOT NULL CHECK (btrim(member_card_id) <> ''),
  display_name_snapshot TEXT NOT NULL CHECK (btrim(display_name_snapshot) <> ''),
  source_active BOOLEAN NOT NULL DEFAULT true,
  captured_at TEXT,
  PRIMARY KEY (event_edition_id, participant_id),
  UNIQUE (event_id, roster_id),
  UNIQUE (event_id, member_card_id),
  FOREIGN KEY (participant_id, event_edition_id)
    REFERENCES public.event_participants(id, event_edition_id)
);
ALTER TABLE public.event_participant_golf_genius_refs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_participant_golf_genius_refs
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_participant_golf_genius_refs
  TO service_role;

ALTER TABLE public.event_rounds
  ADD COLUMN purpose TEXT CHECK (purpose IN ('replay', 'competition')),
  ADD COLUMN golf_genius_course_id TEXT CHECK (btrim(golf_genius_course_id) <> ''),
  ADD COLUMN golf_genius_status TEXT,
  ADD COLUMN source_active BOOLEAN NOT NULL DEFAULT true;
UPDATE public.event_rounds
SET purpose = CASE WHEN counts_toward_competition THEN 'competition' ELSE 'replay' END
WHERE purpose IS NULL;
ALTER TABLE public.event_rounds ALTER COLUMN purpose SET NOT NULL;

ALTER TABLE public.event_round_groups
  ADD COLUMN source_active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.event_round_participants
  ADD COLUMN golf_genius_player_round_id TEXT CHECK (btrim(golf_genius_player_round_id) <> ''),
  ADD COLUMN competition_eligible BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN source_active BOOLEAN NOT NULL DEFAULT true,
  ADD CONSTRAINT event_round_participants_gg_player_round
    UNIQUE (round_id, golf_genius_player_round_id);

CREATE FUNCTION public.sync_event_from_golf_genius(p_snapshot JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_event JSONB := p_snapshot->'event';
  v_roster JSONB;
  v_round JSONB;
  v_group JSONB;
  v_member JSONB;
  v_hole JSONB;
  v_series_id UUID;
  v_edition_id UUID;
  v_golfer_id UUID;
  v_candidate_ids UUID[];
  v_participant_id UUID;
  v_round_id UUID;
  v_group_id UUID;
  v_event_id TEXT;
  v_created INTEGER := 0;
  v_matched INTEGER := 0;
  v_participants INTEGER := 0;
  v_rounds INTEGER := 0;
  v_groups INTEGER := 0;
  v_round_participants INTEGER := 0;
  v_unassigned INTEGER := 0;
BEGIN
  IF jsonb_typeof(p_snapshot) <> 'object' OR jsonb_typeof(v_event) <> 'object'
    OR jsonb_typeof(p_snapshot->'roster') <> 'array'
    OR jsonb_typeof(p_snapshot->'rounds') <> 'array'
    OR NULLIF(btrim(v_event->>'eventId'), '') IS NULL
    OR NULLIF(btrim(v_event->>'seriesSlug'), '') IS NULL
    OR NULLIF(btrim(v_event->>'seriesName'), '') IS NULL
    OR (v_event->>'year') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid Golf Genius event snapshot';
  END IF;

  v_event_id := v_event->>'eventId';
  PERFORM pg_advisory_xact_lock(hashtextextended('gg-event-sync:' || v_event_id, 0));

  INSERT INTO public.event_series(slug, name, is_public)
  VALUES (v_event->>'seriesSlug', v_event->>'seriesName', false)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_series_id;

  SELECT id INTO v_edition_id
  FROM public.event_editions
  WHERE event_series_id = v_series_id AND year = (v_event->>'year')::INTEGER
  FOR UPDATE;
  IF FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.event_editions
      WHERE id = v_edition_id AND golf_genius_event_id IS NOT NULL
        AND golf_genius_event_id <> v_event_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P1004', MESSAGE = 'edition is linked to another Golf Genius event';
    END IF;
    UPDATE public.event_editions SET
      slug = v_event->>'editionSlug', starts_on = (v_event->>'startDate')::DATE,
      ends_on = (v_event->>'endDate')::DATE, location_name = v_event->>'locationName',
      golf_genius_event_id = v_event_id, golf_genius_portal_id = v_event->>'portalId'
    WHERE id = v_edition_id;
  ELSE
    INSERT INTO public.event_editions(event_series_id, slug, year, starts_on, ends_on,
      location_name, visibility, status, golf_genius_event_id)
    VALUES (v_series_id, v_event->>'editionSlug', (v_event->>'year')::INTEGER,
      (v_event->>'startDate')::DATE, (v_event->>'endDate')::DATE,
      v_event->>'locationName', 'invite_only', 'active', v_event_id)
    RETURNING id INTO v_edition_id;
    UPDATE public.event_editions SET golf_genius_portal_id = v_event->>'portalId'
    WHERE id = v_edition_id;
  END IF;

  UPDATE public.event_participant_golf_genius_refs SET source_active = false
  WHERE event_edition_id = v_edition_id;

  FOR v_roster IN SELECT value FROM jsonb_array_elements(p_snapshot->'roster')
  LOOP
    IF NULLIF(btrim(v_roster->>'rosterId'), '') IS NULL
      OR NULLIF(btrim(v_roster->>'memberCardId'), '') IS NULL
      OR NULLIF(btrim(v_roster->>'displayName'), '') IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid Golf Genius roster row';
    END IF;

    SELECT array_agg(DISTINCT candidate.golfer_id) INTO v_candidate_ids
    FROM (
      SELECT golfer_id
      FROM public.golfer_external_identities
      WHERE source_system = 'golf_genius'
        AND external_id = v_roster->>'memberCardId'
        AND resolution_status = 'resolved' AND golfer_id IS NOT NULL
      UNION
      SELECT participant.golfer_id
      FROM public.event_participant_golf_genius_refs source_ref
      JOIN public.event_participants participant
        ON participant.id = source_ref.participant_id
        AND participant.event_edition_id = source_ref.event_edition_id
      WHERE source_ref.member_card_id = v_roster->>'memberCardId'
        AND participant.golfer_id IS NOT NULL
    ) candidate;
    IF COALESCE(array_length(v_candidate_ids, 1), 0) > 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'P1005', MESSAGE = 'Golf Genius member card resolves to multiple canonical golfers';
    END IF;

    v_participant_id := NULL;
    v_golfer_id := NULL;
    SELECT participant.id, participant.golfer_id INTO v_participant_id, v_golfer_id
    FROM public.event_participant_golf_genius_refs source_ref
    JOIN public.event_participants participant
      ON participant.id = source_ref.participant_id
      AND participant.event_edition_id = source_ref.event_edition_id
    WHERE source_ref.event_edition_id = v_edition_id
      AND source_ref.roster_id = v_roster->>'rosterId'
    FOR UPDATE;

    IF v_golfer_id IS NOT NULL AND COALESCE(array_length(v_candidate_ids, 1), 0) = 1
      AND v_golfer_id <> v_candidate_ids[1] THEN
      RAISE EXCEPTION USING ERRCODE = 'P1005', MESSAGE = 'Golf Genius roster identity conflicts with canonical golfer';
    END IF;

    IF v_golfer_id IS NULL THEN
      IF COALESCE(array_length(v_candidate_ids, 1), 0) = 1 THEN
        v_golfer_id := v_candidate_ids[1];
        v_matched := v_matched + 1;
      ELSE
        INSERT INTO public.golfers(display_name) VALUES (v_roster->>'displayName')
        RETURNING id INTO v_golfer_id;
        v_created := v_created + 1;
      END IF;
    ELSE
      v_matched := v_matched + 1;
    END IF;

    IF v_participant_id IS NULL THEN
      SELECT id INTO v_participant_id FROM public.event_participants
      WHERE event_edition_id = v_edition_id AND golfer_id = v_golfer_id
      FOR UPDATE;
    END IF;
    IF v_participant_id IS NULL THEN
      INSERT INTO public.event_participants(event_edition_id, golfer_id, participant_type, status)
      VALUES (v_edition_id, v_golfer_id, 'player', 'confirmed')
      RETURNING id INTO v_participant_id;
    END IF;
    INSERT INTO public.event_participant_golf_genius_refs(
      event_edition_id, participant_id, event_id, roster_id, member_card_id,
      display_name_snapshot, source_active, captured_at)
    VALUES (v_edition_id, v_participant_id, v_event_id, v_roster->>'rosterId',
      v_roster->>'memberCardId', v_roster->>'displayName', true,
      p_snapshot->>'capturedAt')
    ON CONFLICT (event_edition_id, participant_id) DO UPDATE SET
      event_id = EXCLUDED.event_id, roster_id = EXCLUDED.roster_id,
      member_card_id = EXCLUDED.member_card_id,
      display_name_snapshot = EXCLUDED.display_name_snapshot,
      source_active = true, captured_at = EXCLUDED.captured_at;
    v_participants := v_participants + 1;
  END LOOP;

  UPDATE public.event_rounds SET source_active = false
  WHERE event_edition_id = v_edition_id AND golf_genius_round_id IS NOT NULL;

  FOR v_round IN SELECT value FROM jsonb_array_elements(p_snapshot->'rounds')
  LOOP
    IF NULLIF(btrim(v_round->>'roundId'), '') IS NULL
      OR NULLIF(btrim(v_round->>'name'), '') IS NULL
      OR (v_round->>'number') IS NULL OR (v_round->>'date') IS NULL
      OR v_round->>'purpose' NOT IN ('replay', 'competition')
      OR v_round->>'scoreAuthority' NOT IN ('planit', 'golf_genius')
      OR jsonb_typeof(v_round->'groups') <> 'array'
      OR jsonb_typeof(v_round->'participations') <> 'array' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid Golf Genius round row';
    END IF;

    v_round_id := NULL;
    SELECT id INTO v_round_id FROM public.event_rounds
    WHERE event_edition_id = v_edition_id AND golf_genius_round_id = v_round->>'roundId'
    FOR UPDATE;
    IF v_round_id IS NULL THEN
      SELECT id INTO v_round_id FROM public.event_rounds
      WHERE event_edition_id = v_edition_id AND round_number = (v_round->>'number')::INTEGER
        AND golf_genius_round_id IS NULL
      FOR UPDATE;
    END IF;
    IF v_round_id IS NULL THEN
      INSERT INTO public.event_rounds(event_edition_id, round_number, name, course_name,
        starts_on, status, purpose, counts_toward_competition, score_authority,
        golf_genius_round_id, golf_genius_course_id, golf_genius_status, source_active)
      VALUES (v_edition_id, (v_round->>'number')::INTEGER, v_round->>'name',
        v_round->'course'->>'name', (v_round->>'date')::DATE, 'open',
        v_round->>'purpose', (v_round->>'countsTowardCompetition')::BOOLEAN,
        v_round->>'scoreAuthority', v_round->>'roundId', v_round->'course'->>'courseId',
        v_round->>'status', true)
      RETURNING id INTO v_round_id;
    ELSE
      UPDATE public.event_rounds SET round_number = (v_round->>'number')::INTEGER,
        name = v_round->>'name', course_name = v_round->'course'->>'name',
        starts_on = (v_round->>'date')::DATE, purpose = v_round->>'purpose',
        counts_toward_competition = (v_round->>'countsTowardCompetition')::BOOLEAN,
        score_authority = v_round->>'scoreAuthority',
        golf_genius_round_id = v_round->>'roundId',
        golf_genius_course_id = v_round->'course'->>'courseId',
        golf_genius_status = v_round->>'status', source_active = true
      WHERE id = v_round_id;
    END IF;
    v_rounds := v_rounds + 1;

    FOR v_hole IN SELECT value FROM jsonb_array_elements(v_round->'course'->'holes')
    LOOP
      INSERT INTO public.event_round_holes(round_id, hole, par)
      VALUES (v_round_id, (v_hole->>'hole')::INTEGER, (v_hole->>'par')::INTEGER)
      ON CONFLICT (round_id, hole) DO UPDATE SET par = EXCLUDED.par;
    END LOOP;

    UPDATE public.event_round_groups SET source_active = false
    WHERE round_id = v_round_id AND golf_genius_group_id IS NOT NULL;

    FOR v_group IN SELECT value FROM jsonb_array_elements(v_round->'groups')
    LOOP
      INSERT INTO public.event_round_groups(event_edition_id, round_id, name, starts_at,
        starting_hole, golf_genius_group_id, source_active)
      VALUES (v_edition_id, v_round_id, v_group->>'name',
        (v_group->>'startsAt')::TIMESTAMPTZ, (v_group->>'startingHole')::INTEGER,
        v_group->>'groupId', true)
      ON CONFLICT (round_id, golf_genius_group_id) DO UPDATE SET
        name = EXCLUDED.name, starts_at = EXCLUDED.starts_at,
        starting_hole = EXCLUDED.starting_hole, source_active = true
      RETURNING id INTO v_group_id;
      v_groups := v_groups + 1;
    END LOOP;

    UPDATE public.event_round_participants SET source_active = false, group_id = NULL
    WHERE round_id = v_round_id AND golf_genius_player_round_id IS NOT NULL;

    FOR v_member IN SELECT value FROM jsonb_array_elements(v_round->'participations')
    LOOP
      SELECT participant_id INTO v_participant_id
      FROM public.event_participant_golf_genius_refs
      WHERE event_edition_id = v_edition_id
        AND roster_id = v_member->>'rosterId' AND source_active;
      IF v_participant_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P1006', MESSAGE = 'round player is absent from Golf Genius roster';
      END IF;
      v_group_id := NULL;
      IF v_member->>'groupId' IS NOT NULL THEN
        SELECT id INTO v_group_id FROM public.event_round_groups
        WHERE round_id = v_round_id AND golf_genius_group_id = v_member->>'groupId'
          AND source_active = true;
        IF v_group_id IS NULL THEN
          RAISE EXCEPTION USING ERRCODE = 'P1006', MESSAGE = 'round player references an absent Golf Genius group';
        END IF;
      ELSE
        v_unassigned := v_unassigned + 1;
      END IF;

      INSERT INTO public.event_round_participants(event_edition_id, round_id, group_id,
        participant_id, golf_genius_player_round_id, competition_eligible, source_active)
      VALUES (v_edition_id, v_round_id, v_group_id, v_participant_id,
        v_member->>'playerRoundId', (v_round->>'countsTowardCompetition')::BOOLEAN, true)
      ON CONFLICT (round_id, participant_id) DO UPDATE SET
        group_id = EXCLUDED.group_id,
        golf_genius_player_round_id = EXCLUDED.golf_genius_player_round_id,
        competition_eligible = EXCLUDED.competition_eligible, source_active = true;
      v_round_participants := v_round_participants + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'eventEditionId', v_edition_id, 'eventId', v_event_id,
    'golfersCreated', v_created, 'golfersMatched', v_matched,
    'participants', v_participants, 'rounds', v_rounds, 'groups', v_groups,
    'roundParticipations', v_round_participants,
    'unassignedRoundParticipations', v_unassigned
  );
END;
$$;

-- Current event context includes both canonical identity and the exact GG
-- source references needed by a future scorecard/Seve caller.
CREATE OR REPLACE FUNCTION public.read_event_scoring_state(p_event_edition_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'edition', jsonb_build_object('id', e.id, 'seriesSlug', s.slug, 'name', s.name,
      'year', e.year, 'status', e.status, 'visibility', e.visibility,
      'startsOn', e.starts_on, 'endsOn', e.ends_on, 'locationName', e.location_name,
      'golfGeniusEventId', e.golf_genius_event_id,
      'golfGeniusPortalId', e.golf_genius_portal_id),
    'participants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'golferId', p.golfer_id,
        'name', g.display_name, 'type', p.participant_type, 'status', p.status,
        'golfGeniusRosterId', source_identity.roster_id,
        'golfGeniusMemberCardId', source_identity.member_card_id,
        'golfGeniusDisplayName', source_identity.display_name_snapshot) ORDER BY p.id)
      FROM public.event_participants p LEFT JOIN public.golfers g ON g.id = p.golfer_id
      LEFT JOIN public.event_participant_golf_genius_refs source_identity
        ON source_identity.participant_id = p.id
        AND source_identity.event_edition_id = p.event_edition_id
      WHERE p.event_edition_id = e.id AND COALESCE(source_identity.source_active, true)
    ), '[]'::jsonb),
    'rounds', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', r.id, 'number', r.round_number,
        'name', r.name, 'courseName', r.course_name, 'startsOn', r.starts_on,
        'status', r.status, 'purpose', r.purpose,
        'golfGeniusStatus', r.golf_genius_status,
        'countsTowardCompetition', r.counts_toward_competition,
        'scoreAuthority', r.score_authority, 'golfGeniusRoundId', r.golf_genius_round_id,
        'golfGeniusCourseId', r.golf_genius_course_id,
        'participantIds', COALESCE((SELECT jsonb_agg(m.participant_id ORDER BY m.participant_id)
          FROM public.event_round_participants m
          WHERE m.round_id = r.id AND m.source_active), '[]'::jsonb),
        'participations', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'participantId', m.participant_id, 'groupId', m.group_id,
          'competitionEligible', m.competition_eligible,
          'golfGeniusPlayerRoundId', m.golf_genius_player_round_id
          ) ORDER BY m.participant_id)
          FROM public.event_round_participants m
          WHERE m.round_id = r.id AND m.source_active), '[]'::jsonb),
        'holes', COALESCE((SELECT jsonb_agg(jsonb_build_object('hole', h.hole, 'par', h.par) ORDER BY h.hole)
          FROM public.event_round_holes h WHERE h.round_id = r.id), '[]'::jsonb),
        'groups', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name,
          'startsAt', g.starts_at, 'startingHole', g.starting_hole,
          'golfGeniusGroupId', g.golf_genius_group_id,
          'participantIds', COALESCE((SELECT jsonb_agg(m.participant_id ORDER BY m.participant_id)
            FROM public.event_round_participants m
            WHERE m.group_id = g.id AND m.source_active), '[]'::jsonb)
          ) ORDER BY g.starts_at, g.id)
          FROM public.event_round_groups g WHERE g.round_id = r.id AND g.source_active), '[]'::jsonb)
        ) ORDER BY r.round_number)
      FROM public.event_rounds r WHERE r.event_edition_id = e.id AND r.source_active
    ), '[]'::jsonb),
    'scores', COALESCE((SELECT jsonb_agg(to_jsonb(latest) ORDER BY latest.round_id, latest.participant_id, latest.hole)
      FROM (SELECT DISTINCT ON (v.round_id, v.participant_id, v.hole) v.*
        FROM public.event_hole_score_revisions v WHERE v.event_edition_id = e.id
        ORDER BY v.round_id, v.participant_id, v.hole, v.revision DESC) latest
    ), '[]'::jsonb)
  ) FROM public.event_editions e JOIN public.event_series s ON s.id = e.event_series_id
  WHERE e.id = p_event_edition_id;
$$;

REVOKE ALL ON FUNCTION public.sync_event_from_golf_genius(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_event_from_golf_genius(JSONB) TO service_role;

COMMIT;
