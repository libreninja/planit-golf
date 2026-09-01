-- Production Supabase default privileges grant newly-created public functions
-- directly to anon/authenticated/service_role. Revoking PUBLIC alone does not
-- remove those direct ACLs, so make each Harvest function's execution surface
-- explicit. This is a forward-only correction for databases that applied
-- 20260901000000 before its fresh-install ACL statements were strengthened.

REVOKE ALL ON FUNCTION public.claim_capability_invite(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_capability_invite(UUID, TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.validate_capability_invite(TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_capability_invite(TEXT, TEXT) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.has_intel_harvest_entitlement(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_intel_harvest_entitlement(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.has_scouting_entitlement(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_scouting_entitlement(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.has_intel_harvest_captain_entitlement(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_intel_harvest_captain_entitlement(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.jsonb_has_only_keys(JSONB, TEXT[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.seattle_cup_guided_snapshot_v1() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_seattle_cup_guided_snapshot_v1(JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_seattle_cup_guided_report_v1(TEXT, JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_scouting_report_payload(TEXT, TEXT, INTEGER, JSONB, JSONB) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.jsonb_has_only_keys(JSONB, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.seattle_cup_guided_snapshot_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_seattle_cup_guided_snapshot_v1(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_seattle_cup_guided_report_v1(TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_scouting_report_payload(TEXT, TEXT, INTEGER, JSONB, JSONB) TO service_role;
