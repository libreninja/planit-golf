-- Remove legacy "Golf Trip" system (replaced by Good to Go)
-- Migration 001-003 tables that are no longer used

-- Drop functions that reference legacy tables (cleans up security warnings)
DROP FUNCTION IF EXISTS public.is_trip_creator(uuid);
DROP FUNCTION IF EXISTS public.set_registration_runs_updated_at();
DROP FUNCTION IF EXISTS public.set_registration_run_results_updated_at();

-- Drop legacy tables (order matters for FK constraints)
DROP TABLE IF EXISTS public.payments CASCADE;
DROP TABLE IF EXISTS public.rsvps CASCADE;
DROP TABLE IF EXISTS public.memberships CASCADE;
DROP TABLE IF EXISTS public.trips CASCADE;

-- Note: The following Good to Go tables (migration 004+) are preserved:
-- - profiles, members, invites
-- - events, event_time_slots, event_preferences, waitlist_requests
-- - registration_runs, registration_run_results
