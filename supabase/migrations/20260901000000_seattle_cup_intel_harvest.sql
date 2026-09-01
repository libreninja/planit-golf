-- Seattle Cup 2026 Intel Harvest.
--
-- planit-golf owns the durable raw testimony because reporter auth identity,
-- capability invites, and the immutable event archive all live here. This is
-- deliberately NOT the planit-ai scouting-note or future Observation model.
-- Reports are append-only source testimony; planit-ai may later consume them
-- to build reviewed, derived intelligence.

-- Harden the existing generic capability claim without changing its signature,
-- preserving both current scouting and harvest callers. Caller-supplied identity
-- is checked for compatibility only; authority comes from auth.uid() and the
-- confirmed auth.users email. The single conditional UPDATE is the row lock and
-- claim, so concurrent/double claims cannot both succeed.
CREATE OR REPLACE FUNCTION public.claim_capability_invite(
  p_user_id UUID,
  p_email TEXT,
  p_token TEXT,
  p_display_name TEXT DEFAULT NULL
)
RETURNS TABLE(invite_id UUID, granted_club_id UUID, granted_feature_key TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_verified_email TEXT;
  v_invite_id UUID;
  v_club_id UUID;
  v_feature_key TEXT;
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;

  SELECT LOWER(u.email)
  INTO v_verified_email
  FROM auth.users AS u
  WHERE u.id = v_user_id
    AND u.email_confirmed_at IS NOT NULL;

  IF v_verified_email IS NULL
    OR p_user_id IS DISTINCT FROM v_user_id
    OR LOWER(BTRIM(COALESCE(p_email, ''))) <> v_verified_email
  THEN RETURN;
  END IF;

  UPDATE public.capability_invites AS ci
  SET status = 'claimed', claimed_by_user_id = v_user_id,
      claimed_at = NOW(), updated_at = NOW()
  WHERE ci.invite_token = p_token
    AND LOWER(BTRIM(ci.email)) = v_verified_email
    AND ci.status = 'pending'
    AND (ci.expires_at IS NULL OR ci.expires_at > NOW())
  RETURNING ci.id, ci.club_id, ci.feature_key
  INTO v_invite_id, v_club_id, v_feature_key;

  IF v_invite_id IS NULL THEN RETURN; END IF;

  INSERT INTO public.feature_entitlements (
    user_id, club_id, feature_key, status, source, granted_by, granted_at
  ) VALUES (
    v_user_id, v_club_id, v_feature_key, 'active', 'invite', NULL, NOW()
  )
  ON CONFLICT (user_id, club_id, feature_key)
  DO UPDATE SET status = 'active', source = 'invite', granted_by = NULL,
    granted_at = NOW(), revoked_by = NULL, revoked_at = NULL, updated_at = NOW();

  RETURN QUERY SELECT v_invite_id, v_club_id, v_feature_key;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_capability_invite(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_capability_invite(UUID, TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.validate_capability_invite(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_capability_invite(TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.has_intel_harvest_entitlement(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.feature_entitlements AS fe
    JOIN public.clubs AS c ON c.id = fe.club_id
    WHERE p_user_id = auth.uid()
      AND fe.user_id = p_user_id
      AND c.slug = 'igc'
      AND fe.feature_key = 'seattle_cup_intel_contribute'
      AND fe.status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.has_intel_harvest_entitlement(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_intel_harvest_entitlement(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_scouting_entitlement(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.feature_entitlements AS fe
    JOIN public.clubs AS c ON c.id = fe.club_id
    WHERE p_user_id = auth.uid()
      AND fe.user_id = p_user_id
      AND c.slug = 'igc'
      AND fe.feature_key = 'seattle_cup_scouting'
      AND fe.status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.has_scouting_entitlement(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_scouting_entitlement(UUID) TO authenticated;

-- Seattle Cup captain intelligence is deliberately distinct from both the
-- broader Seattle Cup scouting capability and Planit administration. It grants
-- CAPTAIN-report visibility only inside the IGC Seattle Cup intelligence seam.
CREATE OR REPLACE FUNCTION public.has_intel_harvest_captain_entitlement(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.feature_entitlements AS fe
    JOIN public.clubs AS c ON c.id = fe.club_id
    WHERE p_user_id = auth.uid()
      AND fe.user_id = p_user_id
      AND c.slug = 'igc'
      AND fe.feature_key = 'seattle_cup_intel_captain'
      AND fe.status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.has_intel_harvest_captain_entitlement(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_intel_harvest_captain_entitlement(UUID) TO authenticated;

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
  contributor_role TEXT NOT NULL CHECK (
    contributor_role IN ('player', 'caddie', 'captain', 'watcher_supporter', 'other_firsthand')
  ),
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

CREATE POLICY "Seattle Cup reviewers view harvest participants"
  ON public.intel_harvest_participants FOR SELECT
  USING (
    public.has_scouting_entitlement(auth.uid())
    OR public.has_intel_harvest_captain_entitlement(auth.uid())
  );

GRANT SELECT ON public.intel_harvest_participants TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.intel_harvest_participants TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.intel_harvest_participants FROM authenticated;
REVOKE ALL ON public.intel_harvest_participants FROM anon;

-- Questionnaire responses are versioned source evidence, not derived
-- Observations. The application validates the same contract before insert;
-- this database validator prevents malformed JSON from bypassing that boundary.
CREATE OR REPLACE FUNCTION public.jsonb_has_only_keys(p_value JSONB, p_allowed TEXT[])
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(p_value) = 'object'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_value) AS key
      WHERE NOT (key = ANY (p_allowed))
    );
$$;

CREATE OR REPLACE FUNCTION public.seattle_cup_guided_snapshot_v1()
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT $snapshot$
  {
    "key":"seattle-cup-guided-scouting","version":1,
    "reportKinds":[
      {"key":"player_assessment","label":"Player assessment"},
      {"key":"course_observation","label":"Course / hole observation"},
      {"key":"general_observation","label":"General or multi-player observation"}
    ],
    "sectionOrder":["offTheTee","approachIrons","shortGame","putting","temperament","finalAdvice","courseHole"],
    "assessmentHelperText":"Choose only if you saw enough",
    "assessmentOptions":[
      {"key":"strength","label":"Strength"},{"key":"solid","label":"Solid"},
      {"key":"mixed","label":"Mixed"},{"key":"struggled","label":"Struggled"},
      {"key":"didnt_see_enough","label":"Didn't see enough"}
    ],
    "sections":{
      "offTheTee":{"prompt":"Off the tee","helperText":"Choose only what you personally observed.","characteristics":[
        {"key":"missed_left","label":"Missed mostly left"},{"key":"missed_right","label":"Missed mostly right"},
        {"key":"both_ways","label":"Both ways"},{"key":"distance_stood_out","label":"Distance stood out"},
        {"key":"accuracy_stood_out","label":"Accuracy stood out"}],"notePrompt":"Optional note"},
      "approachIrons":{"prompt":"Approach / irons","notePrompt":"Optional note"},
      "shortGame":{"prompt":"Short game","notePrompt":"Optional note"},
      "putting":{"prompt":"Putting","specifics":[
        {"key":"exceptional","label":"Exceptional / made everything"},{"key":"strong_inside_10","label":"Strong inside ~10 feet"},
        {"key":"lag_putting_stood_out","label":"Lag putting stood out"},{"key":"short_putt_struggles","label":"Short-putt struggles"}],"notePrompt":"Optional note"},
      "temperament":{"prompt":"On-course temperament","helperText":"Private Interbay golf shorthand based on what you observed.","labels":[
        {"key":"ice_cold","label":"Ice cold"},{"key":"steady","label":"Steady"},{"key":"rides_momentum","label":"Rides momentum"},
        {"key":"hot_head","label":"Hot head"},{"key":"club_thrower","label":"Club thrower"},{"key":"checks_out","label":"Checks out"},
        {"key":"talker","label":"Talker"},{"key":"quiet_locked_in","label":"Quiet / locked in"},
        {"key":"didnt_see_enough","label":"Didn't see enough"}],
        "supportingNotePrompt":"What did you see? Especially useful for stronger labels."},
      "finalAdvice":{"prompt":"What would you tell an Interbay teammate playing this person next year?"},
      "courseHole":{"prompt":"Any course or hole lesson worth saving?","holePrompt":"Hole numbers, e.g. 4, 12, 18"},
      "general":{"prompt":"What did you see? What should we know?","advicePrompt":"Optional teammate advice"}
    }
  }
  $snapshot$::jsonb;
$$;

CREATE OR REPLACE FUNCTION public.validate_seattle_cup_guided_snapshot_v1(p_snapshot JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT p_snapshot = public.seattle_cup_guided_snapshot_v1();
$$;

CREATE OR REPLACE FUNCTION public.validate_seattle_cup_guided_report_v1(
  p_report_kind TEXT, p_payload JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  section_key TEXT;
  section JSONB;
  item TEXT;
  hole JSONB;
  has_evidence BOOLEAN := FALSE;
BEGIN
  IF jsonb_typeof(p_payload) <> 'object'
    OR p_payload->>'schemaVersion' <> '1'
    OR p_payload->>'kind' <> p_report_kind
  THEN RETURN FALSE; END IF;

  IF p_report_kind = 'course_observation' THEN
    IF NOT public.jsonb_has_only_keys(p_payload, ARRAY['schemaVersion','kind','courseHole'])
      OR NOT public.jsonb_has_only_keys(p_payload->'courseHole', ARRAY['note','holeNumbers'])
      OR jsonb_typeof(p_payload#>'{courseHole,note}') <> 'string'
      OR length(btrim(p_payload#>>'{courseHole,note}')) = 0
    THEN RETURN FALSE; END IF;
  ELSIF p_report_kind = 'general_observation' THEN
    RETURN public.jsonb_has_only_keys(p_payload, ARRAY['schemaVersion','kind','note','finalAdvice'])
      AND jsonb_typeof(p_payload->'note') = 'string'
      AND length(btrim(p_payload->>'note')) > 0
      AND (NOT p_payload ? 'finalAdvice' OR jsonb_typeof(p_payload->'finalAdvice') = 'string');
  ELSIF p_report_kind = 'player_assessment' THEN
    IF NOT public.jsonb_has_only_keys(p_payload, ARRAY['schemaVersion','kind','sections','finalAdvice','courseHole'])
      OR jsonb_typeof(p_payload->'sections') IS DISTINCT FROM 'object'
      OR NOT public.jsonb_has_only_keys(p_payload->'sections', ARRAY['offTheTee','approachIrons','shortGame','putting','temperament'])
      OR (p_payload ? 'finalAdvice' AND jsonb_typeof(p_payload->'finalAdvice') <> 'string')
    THEN RETURN FALSE; END IF;

    FOR section_key IN SELECT jsonb_object_keys(p_payload->'sections') LOOP
      section := p_payload->'sections'->section_key;
      IF section_key = 'offTheTee' THEN
        IF NOT public.jsonb_has_only_keys(section, ARRAY['overall','note','characteristics']) THEN RETURN FALSE; END IF;
      ELSIF section_key = 'putting' THEN
        IF NOT public.jsonb_has_only_keys(section, ARRAY['overall','note','specifics']) THEN RETURN FALSE; END IF;
      ELSIF section_key IN ('approachIrons','shortGame') THEN
        IF NOT public.jsonb_has_only_keys(section, ARRAY['overall','note']) THEN RETURN FALSE; END IF;
      ELSIF section_key = 'temperament' THEN
        IF NOT public.jsonb_has_only_keys(section, ARRAY['labels','supportingNote']) THEN RETURN FALSE; END IF;
      ELSE RETURN FALSE;
      END IF;

      IF section_key <> 'temperament' THEN
        IF section ? 'overall' AND section->>'overall' NOT IN ('strength','solid','mixed','struggled','didnt_see_enough') THEN RETURN FALSE; END IF;
        IF section ? 'note' AND jsonb_typeof(section->'note') <> 'string' THEN RETURN FALSE; END IF;
        has_evidence := has_evidence OR section ? 'overall' OR length(btrim(COALESCE(section->>'note',''))) > 0;
      ELSE
        IF section ? 'supportingNote' AND jsonb_typeof(section->'supportingNote') <> 'string' THEN RETURN FALSE; END IF;
        has_evidence := has_evidence OR length(btrim(COALESCE(section->>'supportingNote',''))) > 0;
      END IF;
    END LOOP;
  ELSE RETURN FALSE;
  END IF;

  IF p_payload#>'{sections,offTheTee,characteristics}' IS NOT NULL THEN
    IF jsonb_typeof(p_payload#>'{sections,offTheTee,characteristics}') <> 'array' THEN RETURN FALSE; END IF;
    FOR item IN SELECT jsonb_array_elements_text(p_payload#>'{sections,offTheTee,characteristics}') LOOP
      IF item NOT IN ('missed_left','missed_right','both_ways','distance_stood_out','accuracy_stood_out') THEN RETURN FALSE; END IF;
      has_evidence := TRUE;
    END LOOP;
  END IF;
  IF p_payload#>'{sections,putting,specifics}' IS NOT NULL THEN
    IF jsonb_typeof(p_payload#>'{sections,putting,specifics}') <> 'array' THEN RETURN FALSE; END IF;
    FOR item IN SELECT jsonb_array_elements_text(p_payload#>'{sections,putting,specifics}') LOOP
      IF item NOT IN ('exceptional','strong_inside_10','lag_putting_stood_out','short_putt_struggles') THEN RETURN FALSE; END IF;
      has_evidence := TRUE;
    END LOOP;
  END IF;
  IF p_payload#>'{sections,temperament,labels}' IS NOT NULL THEN
    IF jsonb_typeof(p_payload#>'{sections,temperament,labels}') <> 'array' THEN RETURN FALSE; END IF;
    FOR item IN SELECT jsonb_array_elements_text(p_payload#>'{sections,temperament,labels}') LOOP
      IF item NOT IN ('ice_cold','steady','rides_momentum','hot_head','club_thrower','checks_out','talker','quiet_locked_in','didnt_see_enough') THEN RETURN FALSE; END IF;
      has_evidence := TRUE;
    END LOOP;
  END IF;

  IF p_payload ? 'courseHole' THEN
    IF NOT public.jsonb_has_only_keys(p_payload->'courseHole', ARRAY['note','holeNumbers'])
      OR jsonb_typeof(p_payload#>'{courseHole,note}') <> 'string'
      OR length(btrim(p_payload#>>'{courseHole,note}')) = 0
    THEN RETURN FALSE; END IF;
    has_evidence := TRUE;
  END IF;
  IF p_payload#>'{courseHole,holeNumbers}' IS NOT NULL THEN
    IF jsonb_typeof(p_payload#>'{courseHole,holeNumbers}') <> 'array' THEN RETURN FALSE; END IF;
    FOR hole IN SELECT value FROM jsonb_array_elements(p_payload#>'{courseHole,holeNumbers}') LOOP
      IF jsonb_typeof(hole) <> 'number' OR (hole#>>'{}')::NUMERIC % 1 <> 0 OR (hole#>>'{}')::INTEGER NOT BETWEEN 1 AND 18 THEN RETURN FALSE; END IF;
    END LOOP;
  END IF;

  RETURN p_report_kind = 'course_observation'
    OR has_evidence
    OR length(btrim(COALESCE(p_payload->>'finalAdvice',''))) > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_scouting_report_payload(
  p_report_kind TEXT, p_questionnaire_key TEXT, p_questionnaire_version INTEGER,
  p_questionnaire_snapshot JSONB, p_payload JSONB
)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT p_questionnaire_key = 'seattle-cup-guided-scouting'
    AND p_questionnaire_version = 1
    AND public.validate_seattle_cup_guided_snapshot_v1(p_questionnaire_snapshot)
    AND public.validate_seattle_cup_guided_report_v1(p_report_kind, p_payload);
$$;

REVOKE ALL ON FUNCTION public.jsonb_has_only_keys(JSONB, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.seattle_cup_guided_snapshot_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_seattle_cup_guided_snapshot_v1(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_seattle_cup_guided_report_v1(TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_scouting_report_payload(TEXT, TEXT, INTEGER, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.jsonb_has_only_keys(JSONB, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.seattle_cup_guided_snapshot_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_seattle_cup_guided_snapshot_v1(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_seattle_cup_guided_report_v1(TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_scouting_report_payload(TEXT, TEXT, INTEGER, JSONB, JSONB) TO service_role;

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
      'prior_golf_experience', 'captain_observation', 'other_firsthand'
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
    report_kind, questionnaire_key, questionnaire_version, questionnaire_snapshot, response_payload
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
    AND (
      public.has_intel_harvest_entitlement(auth.uid())
      OR public.has_scouting_entitlement(auth.uid())
      OR public.has_intel_harvest_captain_entitlement(auth.uid())
    )
  );

CREATE POLICY "Authorized reviewers read harvest reports by visibility"
  ON public.scouting_reports FOR SELECT
  USING (
    public.has_intel_harvest_captain_entitlement(auth.uid())
    OR (
      visibility = 'team'
      AND public.has_scouting_entitlement(auth.uid())
    )
  );

-- Raw reports are source testimony. Only the guarded server action's service
-- client may append. Browser/PostgREST authenticated clients cannot bypass
-- archive and role/context validation, and nobody receives UPDATE/DELETE.
GRANT SELECT ON public.scouting_reports TO authenticated;
GRANT SELECT, INSERT ON public.scouting_reports TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.scouting_reports FROM authenticated;
REVOKE ALL ON public.scouting_reports FROM anon;
