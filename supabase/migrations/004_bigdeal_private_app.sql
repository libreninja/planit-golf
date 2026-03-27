-- Big Deal private member/invite/event schema.

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  email TEXT,
  phone TEXT,
  member_id UUID,
  invite_id UUID,
  is_system_admin BOOLEAN NOT NULL DEFAULT false,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE TABLE public.members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  golf_member_name TEXT NOT NULL,
  golf_member_id TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  invite_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'revoked')),
  claimed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(member_id)
);

ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE SET NULL,
  ADD CONSTRAINT profiles_invite_id_fkey FOREIGN KEY (invite_id) REFERENCES public.invites(id) ON DELETE SET NULL;

CREATE TABLE public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_date DATE NOT NULL UNIQUE,
  course_name TEXT NOT NULL,
  registration_opens_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'locked', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "events_select_all" ON public.events FOR SELECT USING (true);

CREATE TABLE public.event_time_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  time_slot TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, time_slot)
);

ALTER TABLE public.event_time_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_time_slots_select_all" ON public.event_time_slots FOR SELECT USING (true);

CREATE TABLE public.default_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tee_time_preferences TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

ALTER TABLE public.default_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "default_prefs_select_own" ON public.default_preferences FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "default_prefs_insert_own" ON public.default_preferences FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "default_prefs_update_own" ON public.default_preferences FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "default_prefs_delete_own" ON public.default_preferences FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE public.event_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  tee_time_preferences TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, event_id)
);

ALTER TABLE public.event_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_prefs_select_own" ON public.event_preferences FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "event_prefs_insert_own" ON public.event_preferences FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "event_prefs_update_own" ON public.event_preferences FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "event_prefs_delete_own" ON public.event_preferences FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE public.waitlist_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  display_name TEXT,
  phone TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.waitlist_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "waitlist_insert_any" ON public.waitlist_requests FOR INSERT WITH CHECK (true);

CREATE POLICY "members_select_admin" ON public.members
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = auth.uid() AND (profiles.is_admin = true OR profiles.is_system_admin = true)
    )
  );

CREATE POLICY "invites_select_admin" ON public.invites
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = auth.uid() AND (profiles.is_admin = true OR profiles.is_system_admin = true)
    )
  );

CREATE POLICY "invites_insert_admin" ON public.invites
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = auth.uid() AND (profiles.is_admin = true OR profiles.is_system_admin = true)
    )
  );

CREATE POLICY "invites_update_admin" ON public.invites
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = auth.uid() AND (profiles.is_admin = true OR profiles.is_system_admin = true)
    )
  );

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1)),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.validate_invite_token(
  signup_email TEXT,
  signup_token TEXT
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
    FROM public.invites invites
    JOIN public.members members ON members.id = invites.member_id
    WHERE invites.invite_token = signup_token
      AND invites.status = 'pending'
      AND (invites.expires_at IS NULL OR invites.expires_at > NOW())
      AND LOWER(members.email) = LOWER(signup_email)
  )
  INTO invite_exists;

  RETURN invite_exists;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_invite_token(TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_invite_for_user(
  claim_user_id UUID,
  claim_email TEXT,
  claim_token TEXT,
  claim_display_name TEXT DEFAULT NULL
)
RETURNS TABLE(invite_id UUID, member_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_invite public.invites%ROWTYPE;
  target_member public.members%ROWTYPE;
BEGIN
  SELECT invites.*
  INTO target_invite
  FROM public.invites invites
  JOIN public.members members ON members.id = invites.member_id
  WHERE invites.invite_token = claim_token
    AND invites.status = 'pending'
    AND (invites.expires_at IS NULL OR invites.expires_at > NOW())
    AND LOWER(members.email) = LOWER(claim_email)
  LIMIT 1;

  IF target_invite.id IS NULL THEN
    RETURN;
  END IF;

  SELECT *
  INTO target_member
  FROM public.members
  WHERE id = target_invite.member_id;

  UPDATE public.invites
  SET
    status = 'claimed',
    claimed_by_user_id = claim_user_id,
    updated_at = NOW()
  WHERE id = target_invite.id;

  UPDATE public.profiles
  SET
    member_id = target_member.id,
    invite_id = target_invite.id,
    display_name = COALESCE(claim_display_name, target_member.display_name, profiles.display_name),
    email = COALESCE(claim_email, profiles.email),
    phone = COALESCE(target_member.phone, profiles.phone),
    updated_at = NOW()
  WHERE id = claim_user_id;

  RETURN QUERY
  SELECT target_invite.id, target_member.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_invite_for_user(UUID, TEXT, TEXT, TEXT) TO authenticated;
