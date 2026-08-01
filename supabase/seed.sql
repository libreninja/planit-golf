-- Static bootstrap data for planit.golf. Applied after migrations by `supabase db reset`.
-- Genuinely required static config the app expects:
--   - public_pace_checkpoints: the two QR checkpoint tokens (pnpm generate:public-pace-qr
--     generates codes referencing these exact tokens).
--   - communities: the Interbay Golf Club community (organizational bootstrap).
--   - clubs: the IGC club (organizational bootstrap).
-- Per-user data (default_preferences, feature_entitlements) is NOT seeded here.
-- The stale 'upcoming-igc-event' sample igc_events row is intentionally omitted.

INSERT INTO public.public_pace_checkpoints (token, label, course_name, league, hole_number)
VALUES
  ('IQF0he_G-FXX6sTT', 'Checkpoint 1', 'Interbay Golf Center', NULL, NULL),
  ('rLkzBpG0dBNQg4MX', 'Checkpoint 2', 'Interbay Golf Center', NULL, NULL)
ON CONFLICT (token) DO NOTHING;

INSERT INTO public.communities (slug, name, short_name, description, brand_color)
VALUES (
  'interbay-golf-club',
  'Interbay Golf Club',
  'IGC',
  'The Interbay Golf Club community hub on planit.golf.',
  '#2f7d4f'
)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  short_name = EXCLUDED.short_name,
  description = EXCLUDED.description,
  brand_color = EXCLUDED.brand_color,
  updated_at = NOW();

INSERT INTO clubs (slug, name, short_name, description, is_public)
VALUES (
  'igc',
  'Interbay Golf Club',
  'IGC',
  'Seattle golf community with year-round events and competitions',
  true
)
ON CONFLICT (slug) DO NOTHING;