-- Seattle Cup 2026 Intel Harvest.
--
-- planit-golf owns the durable raw testimony because reporter auth identity,
-- capability invites, and the immutable event archive all live here. This is
-- deliberately NOT the planit-ai scouting-note or future Observation model.
-- Reports are append-only source testimony; planit-ai may later consume them
-- to build reviewed, derived intelligence.

CREATE OR REPLACE FUNCTION public.has_intel_harvest_entitlement(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.feature_entitlements
    WHERE user_id = p_user_id
      AND feature_key = 'seattle_cup_intel_contribute'
      AND status = 'active'
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_intel_harvest_entitlement(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_planit_admin(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = p_user_id
      AND (is_admin = true OR is_system_admin = true)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_planit_admin(UUID) TO authenticated;

-- A participant binds an email-bound capability invite/account to one event
-- identity and records only the minimum campaign progress needed for outreach.
-- A name/email/invite binding is not canonical: identity_status remains
-- confirmation_required until the participant explicitly confirms “This is me”.
CREATE TABLE public.intel_harvest_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id TEXT NOT NULL,
  edition_ref TEXT NOT NULL,
  invite_id UUID REFERENCES public.capability_invites(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  reporter_team_key TEXT NOT NULL,
  reporter_player_ref JSONB,
  identity_status TEXT NOT NULL CHECK (
    identity_status IN ('canonical', 'confirmation_required', 'confirmed', 'not_applicable')
  ),
  identity_source TEXT NOT NULL CHECK (
    identity_source IN ('profile_member', 'invite_email', 'admin', 'none')
  ),
  campaign_status TEXT NOT NULL DEFAULT 'invited' CHECK (
    campaign_status IN ('invited', 'claimed', 'started', 'completed', 'skipped')
  ),
  claimed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, email),
  CHECK (jsonb_typeof(reporter_player_ref) = 'object'),
  CHECK (campaign_id = 'seattle-cup-2026-post-event'),
  CHECK (edition_ref = 'seattle-cup:2026'),
  CHECK (reporter_team_key = 'interbay')
);

CREATE UNIQUE INDEX intel_harvest_participants_campaign_user_idx
  ON public.intel_harvest_participants (campaign_id, user_id)
  WHERE user_id IS NOT NULL;
CREATE INDEX intel_harvest_participants_campaign_status_idx
  ON public.intel_harvest_participants (campaign_id, campaign_status);

ALTER TABLE public.intel_harvest_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Harvest participants view themselves"
  ON public.intel_harvest_participants FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Scouting captains and admins view harvest participants"
  ON public.intel_harvest_participants FOR SELECT
  USING (
    public.has_scouting_entitlement(auth.uid())
    OR public.is_planit_admin(auth.uid())
  );

-- Questionnaire responses are versioned source evidence, not derived
-- Observations. The application validates the same contract before insert;
-- this database validator prevents malformed JSON from bypassing that boundary.
CREATE OR REPLACE FUNCTION public.validate_seattle_cup_guided_report_v1(
  p_report_kind TEXT,
  p_payload JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  section_key TEXT;
  section JSONB;
  item TEXT;
  hole JSONB;
BEGIN
  IF jsonb_typeof(p_payload) <> 'object'
    OR p_payload->>'schemaVersion' <> '1'
    OR p_payload->>'kind' <> p_report_kind
  THEN RETURN FALSE;
  END IF;

  IF p_payload#>'{courseHole,holeNumbers}' IS NOT NULL THEN
    IF jsonb_typeof(p_payload#>'{courseHole,holeNumbers}') <> 'array' THEN RETURN FALSE; END IF;
    FOR hole IN SELECT value FROM jsonb_array_elements(p_payload#>'{courseHole,holeNumbers}') LOOP
      IF jsonb_typeof(hole) <> 'number' OR (hole#>>'{}')::NUMERIC % 1 <> 0
        OR (hole#>>'{}')::INTEGER NOT BETWEEN 1 AND 18
      THEN RETURN FALSE; END IF;
    END LOOP;
  END IF;

  IF p_report_kind = 'course_observation' THEN
    RETURN jsonb_typeof(p_payload->'courseHole') = 'object'
      AND jsonb_typeof(p_payload#>'{courseHole,note}') = 'string'
      AND length(btrim(COALESCE(p_payload#>>'{courseHole,note}', ''))) > 0;
  END IF;

  IF p_report_kind = 'general_observation' THEN
    RETURN jsonb_typeof(p_payload->'note') = 'string'
      AND length(btrim(COALESCE(p_payload->>'note', ''))) > 0
      AND (NOT p_payload ? 'finalAdvice' OR (
        jsonb_typeof(p_payload->'finalAdvice') = 'string'
        AND length(btrim(p_payload->>'finalAdvice')) > 0
      ));
  END IF;

  IF p_report_kind <> 'player_assessment'
    OR jsonb_typeof(p_payload->'sections') <> 'object'
  THEN RETURN FALSE;
  END IF;

  FOREACH section_key IN ARRAY ARRAY['offTheTee', 'approachIrons', 'shortGame', 'putting'] LOOP
    section := p_payload->'sections'->section_key;
    IF section IS NOT NULL THEN
      IF jsonb_typeof(section) <> 'object' THEN RETURN FALSE; END IF;
      IF section ? 'overall' AND section->>'overall' NOT IN
        ('strength', 'solid', 'mixed', 'struggled', 'didnt_see_enough')
      THEN RETURN FALSE; END IF;
      IF section ? 'note' AND (jsonb_typeof(section->'note') <> 'string' OR length(btrim(section->>'note')) = 0)
      THEN RETURN FALSE; END IF;
    END IF;
  END LOOP;

  IF p_payload#>'{sections,offTheTee,characteristics}' IS NOT NULL THEN
    IF jsonb_typeof(p_payload#>'{sections,offTheTee,characteristics}') <> 'array' THEN RETURN FALSE; END IF;
    FOR item IN SELECT jsonb_array_elements_text(p_payload#>'{sections,offTheTee,characteristics}') LOOP
      IF item NOT IN ('missed_left', 'missed_right', 'both_ways', 'distance_stood_out', 'accuracy_stood_out') THEN RETURN FALSE; END IF;
    END LOOP;
  END IF;
  IF p_payload#>'{sections,putting,specifics}' IS NOT NULL THEN
    IF jsonb_typeof(p_payload#>'{sections,putting,specifics}') <> 'array' THEN RETURN FALSE; END IF;
    FOR item IN SELECT jsonb_array_elements_text(p_payload#>'{sections,putting,specifics}') LOOP
      IF item NOT IN ('exceptional', 'strong_inside_10', 'lag_putting_stood_out', 'short_putt_struggles') THEN RETURN FALSE; END IF;
    END LOOP;
  END IF;
  IF p_payload#>'{sections,temperament,labels}' IS NOT NULL THEN
    IF jsonb_typeof(p_payload#>'{sections,temperament,labels}') <> 'array' THEN RETURN FALSE; END IF;
    FOR item IN SELECT jsonb_array_elements_text(p_payload#>'{sections,temperament,labels}') LOOP
      IF item NOT IN ('ice_cold', 'steady', 'rides_momentum', 'hot_head', 'club_thrower', 'checks_out', 'talker', 'quiet_locked_in', 'didnt_see_enough') THEN RETURN FALSE; END IF;
    END LOOP;
  END IF;

  IF p_payload#>'{sections,temperament}' IS NOT NULL
    AND jsonb_typeof(p_payload#>'{sections,temperament}') <> 'object'
  THEN RETURN FALSE; END IF;
  IF p_payload#>'{sections,temperament,supportingNote}' IS NOT NULL
    AND (jsonb_typeof(p_payload#>'{sections,temperament,supportingNote}') <> 'string'
      OR length(btrim(p_payload#>>'{sections,temperament,supportingNote}')) = 0)
  THEN RETURN FALSE; END IF;
  IF p_payload ? 'finalAdvice'
    AND (jsonb_typeof(p_payload->'finalAdvice') <> 'string'
      OR length(btrim(p_payload->>'finalAdvice')) = 0)
  THEN RETURN FALSE; END IF;
  IF p_payload ? 'courseHole'
    AND (jsonb_typeof(p_payload->'courseHole') <> 'object'
      OR jsonb_typeof(p_payload#>'{courseHole,note}') <> 'string'
      OR length(btrim(p_payload#>>'{courseHole,note}')) = 0)
  THEN RETURN FALSE; END IF;

  RETURN EXISTS (
      SELECT 1
      FROM jsonb_each(p_payload->'sections') AS selected(key, value)
      WHERE jsonb_typeof(value) = 'object' AND value <> '{}'::jsonb
    )
    OR length(btrim(COALESCE(p_payload->>'finalAdvice', ''))) > 0
    OR length(btrim(COALESCE(p_payload#>>'{courseHole,note}', ''))) > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_scouting_report_payload(
  p_report_kind TEXT,
  p_questionnaire_key TEXT,
  p_questionnaire_version INTEGER,
  p_payload JSONB
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_questionnaire_key = 'seattle-cup-guided-scouting' AND p_questionnaire_version = 1
      THEN public.validate_seattle_cup_guided_report_v1(p_report_kind, p_payload)
    ELSE FALSE
  END;
$$;

-- One row is one coherent assessment of one subject/context. Subjects remain
-- stable archive refs; course reports have none and general reports may have
-- multiple. The exact questionnaire and selected human assertions stay intact.
CREATE TABLE public.scouting_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reporter_player_ref JSONB,
  reporter_team_key TEXT NOT NULL,
  contributor_role TEXT NOT NULL CHECK (
    contributor_role IN ('player', 'caddie', 'captain', 'watcher_supporter', 'other_firsthand')
  ),
  relationship_context TEXT NOT NULL CHECK (
    relationship_context IN (
      'played_against', 'played_with', 'caddied', 'watched_match', 'watched_player',
      'prior_golf_experience', 'captain_observation', 'other_firsthand', 'relayed'
    )
  ),
  report_kind TEXT NOT NULL CHECK (
    report_kind IN ('player_assessment', 'course_observation', 'general_observation')
  ),
  contributed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  campaign_id TEXT NOT NULL,
  edition_ref TEXT NOT NULL,
  subjects JSONB NOT NULL DEFAULT '[]'::jsonb,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  questionnaire_key TEXT NOT NULL,
  questionnaire_version INTEGER NOT NULL,
  questionnaire_snapshot JSONB NOT NULL,
  response_payload JSONB NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('team', 'captain')),
  provenance JSONB NOT NULL DEFAULT
    '{"kind":"human","channel":"intel_harvest"}'::jsonb,
  CHECK (jsonb_typeof(reporter_player_ref) = 'object'),
  CHECK (jsonb_typeof(subjects) = 'array'),
  CHECK (jsonb_typeof(context) = 'object'),
  CHECK (jsonb_typeof(questionnaire_snapshot) = 'object'),
  CHECK (jsonb_typeof(response_payload) = 'object'),
  CHECK (questionnaire_snapshot->>'key' = questionnaire_key),
  CHECK ((questionnaire_snapshot->>'version')::INTEGER = questionnaire_version),
  CHECK (public.validate_scouting_report_payload(
    report_kind, questionnaire_key, questionnaire_version, response_payload
  )),
  CHECK (
    (report_kind = 'player_assessment' AND jsonb_array_length(subjects) = 1)
    OR (report_kind = 'course_observation' AND jsonb_array_length(subjects) = 0)
    OR report_kind = 'general_observation'
  ),
  CHECK (provenance = '{"kind":"human","channel":"intel_harvest"}'::jsonb),
  CHECK (campaign_id = 'seattle-cup-2026-post-event'),
  CHECK (edition_ref = 'seattle-cup:2026'),
  CHECK (reporter_team_key = 'interbay')
);

CREATE INDEX scouting_reports_reporter_campaign_idx
  ON public.scouting_reports (reporter_user_id, campaign_id, contributed_at DESC);
CREATE INDEX scouting_reports_campaign_contributed_idx
  ON public.scouting_reports (campaign_id, contributed_at DESC);
CREATE INDEX scouting_reports_subjects_gin_idx
  ON public.scouting_reports USING GIN (subjects);
CREATE INDEX scouting_reports_context_gin_idx
  ON public.scouting_reports USING GIN (context);

ALTER TABLE public.scouting_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Harvest contributors view their own reports"
  ON public.scouting_reports FOR SELECT
  USING (
    reporter_user_id = auth.uid()
    AND public.has_intel_harvest_entitlement(auth.uid())
  );

CREATE POLICY "Scouting captains and admins review harvested reports"
  ON public.scouting_reports FOR SELECT
  USING (
    public.has_scouting_entitlement(auth.uid())
    OR public.is_planit_admin(auth.uid())
  );

CREATE POLICY "Harvest contributors append their own reports"
  ON public.scouting_reports FOR INSERT
  WITH CHECK (
    reporter_user_id = auth.uid()
    AND (
      public.has_intel_harvest_entitlement(auth.uid())
      OR public.has_scouting_entitlement(auth.uid())
      OR public.is_planit_admin(auth.uid())
    )
  );

-- Raw reports are source testimony. Authenticated users can append/read only;
-- there is intentionally no UPDATE or DELETE policy.
REVOKE UPDATE, DELETE ON public.scouting_reports FROM authenticated;
