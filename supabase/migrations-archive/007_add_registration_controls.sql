ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS registrations_paused BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS membership_revoked BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.event_preferences
  ADD COLUMN IF NOT EXISTS skip_registration BOOLEAN NOT NULL DEFAULT false;
