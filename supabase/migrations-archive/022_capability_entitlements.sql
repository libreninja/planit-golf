-- Capability entitlements + capability invites (Seattle Cup scouting access).
--
-- Model (see docs/access-onboarding-design-addendum.md):
--   PlanIt account (auth.users/profiles)
--     ├── IGC membership (OPTIONAL) — club_memberships, club=IGC. Created only
--     │   when a person is actually an IGC member/affiliate. NOT auto-created.
--     └── Seattle Cup scouting entitlement — feature_entitlements row below.
--
-- CRITICAL (§4): scouting does NOT require IGC membership. claim_capability_invite
-- and admin grants create ONLY a feature_entitlements row — never a
-- club_memberships row. The scouting gate checks the entitlement alone.
--
-- capability_invites is email-based and has NO dependency on the GG `members`
-- roster, so a scouting captain who is not a GG member (e.g. an outside
-- consultant) can still be invited and claim access. This mirrors the GTG
-- invites + claim_invite_for_user pattern (migration 004) but is separate and
-- does not touch members/profiles/invites.

-- ---------------------------------------------------------------------------
-- feature_entitlements: a granted capability for a user, scoped to a club.
-- ---------------------------------------------------------------------------
CREATE TABLE public.feature_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  -- Known keys today: 'seattle_cup_scouting'. Free-form text so future
  -- capabilities don't need a migration to add a value.
  feature_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  source TEXT NOT NULL CHECK (source IN ('invite', 'admin')),
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- One entitlement record per user/club/feature. Re-grant after revocation
  -- upserts this row (flips status back to active) rather than duplicating.
  UNIQUE (user_id, club_id, feature_key)
);

CREATE INDEX feature_entitlements_user_idx ON public.feature_entitlements (user_id);
CREATE INDEX feature_entitlements_club_feature_status_idx
  ON public.feature_entitlements (club_id, feature_key, status);

ALTER TABLE public.feature_entitlements ENABLE ROW LEVEL SECURITY;

-- Users may read their own entitlements (so the access gate can run with the
-- user's own client). All writes go through the service-role client (admin
-- actions) or the claim RPC, both of which bypass RLS.
CREATE POLICY "Users view their own entitlements"
  ON public.feature_entitlements FOR SELECT
  USING (user_id = auth.uid());

CREATE TRIGGER feature_entitlements_updated_at
  BEFORE UPDATE ON public.feature_entitlements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- capability_invites: email-based invite to claim a capability.
-- ---------------------------------------------------------------------------
CREATE TABLE public.capability_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  email TEXT NOT NULL,
  invite_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'revoked', 'expired')),
  claimed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  display_name TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- One open invite per email/club/feature (re-invite upserts the pending row).
  UNIQUE (email, club_id, feature_key)
);

CREATE INDEX capability_invites_token_idx ON public.capability_invites (invite_token);
CREATE INDEX capability_invites_email_club_feature_idx
  ON public.capability_invites (email, club_id, feature_key);

ALTER TABLE public.capability_invites ENABLE ROW LEVEL SECURITY;

-- No direct user SELECT/INSERT/UPDATE/DELETE: invites are managed by admins
-- (service-role) and validated/claimed only through the SECURITY DEFINER RPCs
-- below. RLS therefore denies all user access by default.

CREATE TRIGGER capability_invites_updated_at
  BEFORE UPDATE ON public.capability_invites
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- validate_capability_invite: pre-auth check used by the signup/accept flow.
-- Returns true if a pending, unexpired invite matches the email + token.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_capability_invite(
  p_email TEXT,
  p_token TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invite_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.capability_invites
    WHERE invite_token = p_token
      AND LOWER(email) = LOWER(p_email)
      AND status = 'pending'
      AND (expires_at IS NULL OR expires_at > NOW())
  )
  INTO invite_exists;

  RETURN invite_exists;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_capability_invite(TEXT, TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- claim_capability_invite: post-auth claim. Marks the invite claimed and
-- idempotently grants the feature entitlement. Does NOT create an IGC
-- club_memberships row (scouting does not require IGC membership).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_capability_invite(
  p_user_id UUID,
  p_email TEXT,
  p_token TEXT,
  p_display_name TEXT DEFAULT NULL
)
RETURNS TABLE(invite_id UUID, granted_club_id UUID, granted_feature_key TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite_id UUID;
  v_club_id UUID;
  v_feature_key TEXT;
BEGIN
  SELECT ci.id, ci.club_id, ci.feature_key
  INTO v_invite_id, v_club_id, v_feature_key
  FROM public.capability_invites AS ci
  WHERE ci.invite_token = p_token
    AND LOWER(ci.email) = LOWER(p_email)
    AND ci.status = 'pending'
    AND (ci.expires_at IS NULL OR ci.expires_at > NOW())
  LIMIT 1;

  IF v_invite_id IS NULL THEN
    RETURN;
  END IF;

  -- Mark the invite claimed.
  UPDATE public.capability_invites
  SET
    status = 'claimed',
    claimed_by_user_id = p_user_id,
    claimed_at = NOW(),
    updated_at = NOW()
  WHERE id = v_invite_id;

  -- Grant the entitlement ONLY (no club_memberships row). Idempotent: if a
  -- revoked entitlement already exists for this user/club/feature, reactivate
  -- it rather than violating the unique constraint.
  INSERT INTO public.feature_entitlements (
    user_id, club_id, feature_key, status, source, granted_by, granted_at
  )
  VALUES (
    p_user_id, v_club_id, v_feature_key, 'active', 'invite', NULL, NOW()
  )
  ON CONFLICT (user_id, club_id, feature_key)
  DO UPDATE SET
    status = 'active',
    source = 'invite',
    granted_by = NULL,
    granted_at = NOW(),
    revoked_by = NULL,
    revoked_at = NULL,
    updated_at = NOW();

  RETURN QUERY
  SELECT v_invite_id, v_club_id, v_feature_key;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_capability_invite(UUID, TEXT, TEXT, TEXT) TO authenticated;