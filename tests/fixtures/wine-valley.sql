-- Synthetic demo only. Dates, tee times and all-par-four holes are NOT the
-- confirmed trip itinerary/course card. Never part of production seed/migrations.
INSERT INTO public.event_series (id, slug, name, is_public) VALUES
  ('10000000-0000-4000-8000-000000000100', 'wine-valley-demo', 'Wine Valley demo', false);
INSERT INTO public.event_editions (id, event_series_id, year, starts_on, ends_on, location_name, visibility, status, golf_genius_event_id) VALUES
  ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000100', 2026,
   '2026-09-25', '2026-09-26', 'Wine Valley (fixture)', 'invite_only', 'active', 'fixture-upstream-event'),
  ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000100', 2027,
   '2027-09-24', '2027-09-25', 'Other edition', 'invite_only', 'active', NULL);
INSERT INTO public.golfers (id, display_name) VALUES
  ('40000000-0000-4000-8000-000000000001', 'Bob'),
  ('40000000-0000-4000-8000-000000000002', 'Tom'),
  ('40000000-0000-4000-8000-000000000003', 'Luke'),
  ('40000000-0000-4000-8000-000000000004', 'Jamie'),
  ('40000000-0000-4000-8000-000000000005', 'Amelia'),
  ('40000000-0000-4000-8000-000000000006', 'Taylor');
INSERT INTO public.event_participants (id, event_edition_id, golfer_id, status)
SELECT ('50000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '10000000-0000-4000-8000-000000000001',
  ('40000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'confirmed'
FROM generate_series(1, 6) n;
INSERT INTO public.event_rounds (id, event_edition_id, round_number, name, course_name, starts_on, status,
  purpose, counts_toward_competition, score_authority, golf_genius_round_id)
SELECT ('20000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '10000000-0000-4000-8000-000000000001', n, name,
  'Wine Valley (synthetic nine-hole fixture)', DATE '2026-09-25' + ((n - 1) / 2), 'open',
  CASE WHEN included THEN 'competition' ELSE 'replay' END,
  included, 'planit', 'fixture-upstream-round-' || n
FROM (VALUES (1, 'Friday AM (p)replay', false), (2, 'Friday PM competition', true),
  (3, 'Saturday AM competition', true), (4, 'Saturday PM replay', false)) AS rounds(n, name, included);
INSERT INTO public.event_round_holes (round_id, hole, par)
SELECT r.id, h, 4 FROM public.event_rounds r CROSS JOIN generate_series(1, 9) h;
INSERT INTO public.event_round_groups (id, event_edition_id, round_id, name, starts_at, starting_hole)
SELECT ('30000000-0000-4000-8000-' || lpad(round_number::text, 12, '0'))::uuid,
  event_edition_id, id, 'Group 1',
  (starts_on + CASE WHEN round_number IN (1, 3) THEN TIME '08:00' ELSE TIME '13:15' END)
    AT TIME ZONE 'America/Los_Angeles', 1
FROM public.event_rounds;
INSERT INTO public.event_round_participants (event_edition_id, round_id, group_id, participant_id, competition_eligible)
SELECT g.event_edition_id, g.round_id, g.id, p.id, r.counts_toward_competition
FROM public.event_round_groups g JOIN public.event_participants p ON p.event_edition_id = g.event_edition_id
JOIN public.event_rounds r ON r.id = g.round_id
WHERE p.id IN ('50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000004')
  OR r.round_number = 1
  OR (r.round_number = 4 AND p.id = '50000000-0000-4000-8000-000000000005');
