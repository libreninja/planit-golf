ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_system_admin BOOLEAN NOT NULL DEFAULT false;

DROP POLICY IF EXISTS "members_select_admin" ON public.members;
CREATE POLICY "members_select_admin" ON public.members
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (profiles.is_admin = true OR profiles.is_system_admin = true)
    )
  );

DROP POLICY IF EXISTS "invites_select_admin" ON public.invites;
CREATE POLICY "invites_select_admin" ON public.invites
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (profiles.is_admin = true OR profiles.is_system_admin = true)
    )
  );

DROP POLICY IF EXISTS "invites_insert_admin" ON public.invites;
CREATE POLICY "invites_insert_admin" ON public.invites
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (profiles.is_admin = true OR profiles.is_system_admin = true)
    )
  );

DROP POLICY IF EXISTS "invites_update_admin" ON public.invites;
CREATE POLICY "invites_update_admin" ON public.invites
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (profiles.is_admin = true OR profiles.is_system_admin = true)
    )
  );
