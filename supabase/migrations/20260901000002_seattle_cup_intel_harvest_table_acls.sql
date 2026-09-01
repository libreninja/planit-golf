-- Supabase production default privileges grant newly-created public tables
-- directly to anon/authenticated/service_role. Make the two Harvest tables'
-- privilege surfaces explicit so authenticated clients cannot bypass the
-- append-only server boundary with TRUNCATE (which RLS does not cover), and
-- service_role cannot rewrite or remove raw testimony.

REVOKE ALL ON public.intel_harvest_participants FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.intel_harvest_participants TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.intel_harvest_participants TO service_role;

REVOKE ALL ON public.scouting_reports FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.scouting_reports TO authenticated;
GRANT SELECT, INSERT ON public.scouting_reports TO service_role;
