-- Run after the harvest migration in a disposable Supabase-compatible DB.
-- Exercises real roles, grants, RLS, claim atomicity, revocation, and payload checks.
CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition BOOLEAN, message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN IF NOT condition THEN RAISE EXCEPTION 'assertion failed: %', message; END IF; END $$;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('10000000-0000-0000-0000-000000000001', 'one@example.com', NOW()),
  ('10000000-0000-0000-0000-000000000002', 'two@example.com', NOW()),
  ('10000000-0000-0000-0000-000000000003', 'reviewer@example.com', NOW()),
  ('10000000-0000-0000-0000-000000000004', 'admin@example.com', NOW()),
  ('10000000-0000-0000-0000-000000000005', 'cross@example.com', NOW()),
  ('10000000-0000-0000-0000-000000000006', 'unverified@example.com', NULL),
  ('10000000-0000-0000-0000-000000000007', 'captain@example.com', NOW()),
  ('10000000-0000-0000-0000-000000000008', 'other-event@example.com', NOW());

INSERT INTO public.clubs (id, slug) VALUES
  ('20000000-0000-0000-0000-000000000001', 'igc'),
  ('20000000-0000-0000-0000-000000000002', 'other-club');
INSERT INTO public.profiles (id, is_admin, is_system_admin) VALUES
  ('10000000-0000-0000-0000-000000000001', false, false),
  ('10000000-0000-0000-0000-000000000002', false, false),
  ('10000000-0000-0000-0000-000000000003', false, false),
  ('10000000-0000-0000-0000-000000000004', true, false),
  ('10000000-0000-0000-0000-000000000005', false, false),
  ('10000000-0000-0000-0000-000000000006', false, false),
  ('10000000-0000-0000-0000-000000000007', false, false),
  ('10000000-0000-0000-0000-000000000008', false, false);

INSERT INTO public.feature_entitlements (user_id, club_id, feature_key, status, source) VALUES
  ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','seattle_cup_intel_contribute','active','admin'),
  ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','seattle_cup_intel_contribute','active','admin'),
  ('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','seattle_cup_scouting','active','admin'),
  ('10000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','seattle_cup_scouting','active','admin'),
  ('10000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000002','seattle_cup_intel_contribute','active','admin'),
  ('10000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000002','seattle_cup_scouting','active','admin'),
  ('10000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000002','seattle_cup_intel_captain','active','admin'),
  ('10000000-0000-0000-0000-000000000007','20000000-0000-0000-0000-000000000001','seattle_cup_intel_captain','active','admin'),
  ('10000000-0000-0000-0000-000000000008','20000000-0000-0000-0000-000000000001','other_event_intel_captain','active','admin');

INSERT INTO public.capability_invites (id, club_id, feature_key, email, invite_token, status, expires_at) VALUES
  ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','seattle_cup_intel_contribute','one@example.com','claim-good','pending',NOW()+INTERVAL '1 day'),
  ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','seattle_cup_scouting','one@example.com','claim-revoked','revoked',NOW()+INTERVAL '1 day'),
  ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','seattle_cup_scouting','two@example.com','claim-expired','pending',NOW()-INTERVAL '1 day'),
  ('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','seattle_cup_scouting','unverified@example.com','claim-unverified','pending',NOW()+INTERVAL '1 day');

-- Wrong authenticated identity/email cannot claim.
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.claim_capability_invite(uuid,text,text,text)','EXECUTE'), 'anonymous claim execution revoked');
SELECT pg_temp.assert_true(has_function_privilege('authenticated','public.claim_capability_invite(uuid,text,text,text)','EXECUTE'), 'authenticated claim execution granted');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.claim_capability_invite('10000000-0000-0000-0000-000000000002','two@example.com','claim-good',NULL)) = 0, 'wrong email claim rejected');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT status FROM public.capability_invites WHERE invite_token='claim-good') = 'pending', 'wrong claim leaves invite pending');

-- Authenticated confirmed owner claims once; double claim fails atomically.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.claim_capability_invite('10000000-0000-0000-0000-000000000001','one@example.com','claim-good',NULL)) = 1, 'correct claim succeeds');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.claim_capability_invite('10000000-0000-0000-0000-000000000001','one@example.com','claim-good',NULL)) = 0, 'double claim rejected');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.claim_capability_invite('10000000-0000-0000-0000-000000000001','one@example.com','claim-revoked',NULL)) = 0, 'revoked invite rejected');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.claim_capability_invite('10000000-0000-0000-0000-000000000002','one@example.com','claim-revoked',NULL)) = 0, 'caller user id forgery rejected');
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.claim_capability_invite('10000000-0000-0000-0000-000000000002','two@example.com','claim-expired',NULL)) = 0, 'expired claim rejected');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000006',false);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.claim_capability_invite('10000000-0000-0000-0000-000000000006','unverified@example.com','claim-unverified',NULL)) = 0, 'unverified email claim rejected');
RESET ROLE;

-- Cross-club entitlement never authorizes IGC.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',false);
SELECT pg_temp.assert_true(NOT public.has_intel_harvest_entitlement('10000000-0000-0000-0000-000000000005'), 'cross-club entitlement rejected');
SELECT pg_temp.assert_true(NOT public.has_scouting_entitlement('10000000-0000-0000-0000-000000000005'), 'cross-club scouting entitlement rejected');
SELECT pg_temp.assert_true(NOT public.has_intel_harvest_captain_entitlement('10000000-0000-0000-0000-000000000005'), 'cross-club captain entitlement rejected');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000008',false);
SELECT pg_temp.assert_true(NOT public.has_intel_harvest_captain_entitlement('10000000-0000-0000-0000-000000000008'), 'unrelated event capability rejected');
RESET ROLE;

-- Helper execution is explicit; validation internals are not browser-callable.
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.has_intel_harvest_entitlement(uuid)','EXECUTE'), 'anonymous harvest helper execution revoked');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.has_scouting_entitlement(uuid)','EXECUTE'), 'anonymous scouting helper execution revoked');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.has_intel_harvest_captain_entitlement(uuid)','EXECUTE'), 'anonymous captain helper execution revoked');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','public.validate_scouting_report_payload(text,text,integer,jsonb,jsonb)','EXECUTE'), 'authenticated validator execution revoked');
SELECT pg_temp.assert_true(has_function_privilege('service_role','public.validate_scouting_report_payload(text,text,integer,jsonb,jsonb)','EXECUTE'), 'service validator execution granted');

-- Intended privileged write path succeeds. No authenticated write grant exists.
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated','public.scouting_reports','INSERT'), 'direct authenticated insert denied');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated','public.scouting_reports','UPDATE'), 'authenticated update denied');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated','public.scouting_reports','DELETE'), 'authenticated delete denied');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated','public.scouting_reports','TRUNCATE'), 'authenticated truncate denied');
SELECT pg_temp.assert_true(has_table_privilege('service_role','public.scouting_reports','INSERT'), 'guarded service write enabled');
SELECT pg_temp.assert_true(NOT has_table_privilege('service_role','public.scouting_reports','UPDATE'), 'service update denied');
SELECT pg_temp.assert_true(NOT has_table_privilege('service_role','public.scouting_reports','DELETE'), 'service delete denied');
SELECT pg_temp.assert_true(NOT has_table_privilege('service_role','public.scouting_reports','TRUNCATE'), 'service truncate denied');

SET ROLE service_role;
INSERT INTO public.scouting_reports (
  id, reporter_user_id, reporter_team_key, contributor_role, relationship_context,
  report_kind, campaign_id, edition_ref, subjects, context, questionnaire_key,
  questionnaire_version, questionnaire_snapshot, response_payload, visibility
) VALUES
  ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','interbay','watcher_supporter','watched_match','general_observation','seattle-cup-2026-post-event','seattle-cup:2026','[]','{"archiveId":"seattle-cup:2026","matchNos":[48]}','seattle-cup-guided-scouting',1,public.seattle_cup_guided_snapshot_v1(),'{"schemaVersion":1,"kind":"general_observation","note":"Team evidence"}','team'),
  ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','interbay','captain','captain_observation','general_observation','seattle-cup-2026-post-event','seattle-cup:2026','[]','{"archiveId":"seattle-cup:2026","matchNos":[]}','seattle-cup-guided-scouting',1,public.seattle_cup_guided_snapshot_v1(),'{"schemaVersion":1,"kind":"general_observation","note":"Captain evidence"}','captain'),
  ('40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','interbay','caddie','caddied','general_observation','seattle-cup-2026-post-event','seattle-cup:2026','[]','{"archiveId":"seattle-cup:2026","matchNos":[]}','seattle-cup-guided-scouting',1,public.seattle_cup_guided_snapshot_v1(),'{"schemaVersion":1,"kind":"general_observation","note":"Other contributor"}','team');
RESET ROLE;

-- Contributor owns two, cannot see another contributor.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.scouting_reports) = 2, 'contributor reads own reports');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.scouting_reports WHERE reporter_user_id='10000000-0000-0000-0000-000000000002'), 'contributor cannot read another');
RESET ROLE;

-- A scouting reviewer sees TEAM only.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',false);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.scouting_reports) = 2, 'reviewer reads team reports');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.scouting_reports WHERE visibility='captain'), 'reviewer cannot read captain reports');
RESET ROLE;

-- General Planit admin status does not elevate an otherwise ordinary scouting
-- reviewer to CAPTAIN visibility.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',false);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.scouting_reports) = 2, 'admin with scouting reads team reports only');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.scouting_reports WHERE visibility='captain'), 'Planit admin without captain entitlement cannot read captain reports');
RESET ROLE;

-- Narrow IGC Seattle Cup captain entitlement reads both classes without
-- granting or requiring either Planit admin or scouting authority.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000007',false);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.scouting_reports) = 3, 'Seattle Cup captain reads team and captain reports');
SELECT pg_temp.assert_true(public.has_intel_harvest_captain_entitlement('10000000-0000-0000-0000-000000000007'), 'captain entitlement active');
SELECT pg_temp.assert_true(NOT public.has_scouting_entitlement('10000000-0000-0000-0000-000000000007'), 'captain entitlement does not grant scouting');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT NOT is_admin AND NOT is_system_admin FROM public.profiles WHERE id='10000000-0000-0000-0000-000000000007'), 'Seattle Cup captain has no Planit admin role');

-- Unauthorized and revoked users read nothing; historical rows remain.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',false);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.scouting_reports) = 0, 'unauthorized user reads nothing');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000008',false);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.scouting_reports) = 0, 'unrelated event capability reads nothing');
RESET ROLE;
UPDATE public.feature_entitlements SET status='revoked' WHERE user_id='10000000-0000-0000-0000-000000000001' AND feature_key='seattle_cup_intel_contribute';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.scouting_reports) = 0, 'revoked contributor loses read access');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*) FROM public.scouting_reports WHERE reporter_user_id='10000000-0000-0000-0000-000000000001') = 2, 'reports remain after revocation');

UPDATE public.feature_entitlements SET status='revoked' WHERE user_id='10000000-0000-0000-0000-000000000007' AND feature_key='seattle_cup_intel_captain';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000007',false);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.scouting_reports) = 0, 'revoked captain loses report access');
SELECT pg_temp.assert_true(NOT public.has_intel_harvest_captain_entitlement('10000000-0000-0000-0000-000000000007'), 'revoked captain helper denies access');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*) FROM public.scouting_reports) = 3, 'captain revocation leaves historical testimony intact');

-- Malformed, unknown-only, and snapshot/version disagreement are DB-rejected.
DO $$
DECLARE candidate JSONB;
BEGIN
  FOREACH candidate IN ARRAY ARRAY[
    '{"schemaVersion":1,"kind":"player_assessment","sections":{"bogus":{"anything":"x"}}}'::jsonb,
    '{"schemaVersion":1,"kind":"player_assessment","sections":{"putting":{"overall":"elite"}}}'::jsonb,
    '{"schemaVersion":1,"kind":"player_assessment","sections":{"putting":{"overall":"solid","extra":true}}}'::jsonb,
    '{"schemaVersion":2,"kind":"player_assessment","sections":{"putting":{"overall":"solid"}}}'::jsonb,
    '{"schemaVersion":1,"kind":"general_observation","note":"wrong report kind"}'::jsonb
  ] LOOP
    BEGIN
      INSERT INTO public.scouting_reports (reporter_user_id,reporter_team_key,contributor_role,relationship_context,report_kind,campaign_id,edition_ref,subjects,context,questionnaire_key,questionnaire_version,questionnaire_snapshot,response_payload,visibility)
      VALUES ('10000000-0000-0000-0000-000000000001','interbay','player','played_against','player_assessment','seattle-cup-2026-post-event','seattle-cup:2026','[{"system":"golfgenius","kind":"member_card","value":"card","displayName":"Player","teamKey":null}]','{"matchNos":[]}','seattle-cup-guided-scouting',1,public.seattle_cup_guided_snapshot_v1(),candidate,'team');
      RAISE EXCEPTION 'malformed payload accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  BEGIN
    INSERT INTO public.scouting_reports (reporter_user_id,reporter_team_key,contributor_role,relationship_context,report_kind,campaign_id,edition_ref,subjects,context,questionnaire_key,questionnaire_version,questionnaire_snapshot,response_payload,visibility)
    VALUES ('10000000-0000-0000-0000-000000000001','interbay','watcher_supporter','watched_match','general_observation','seattle-cup-2026-post-event','seattle-cup:2026','[]','{"matchNos":[]}','seattle-cup-guided-scouting',1,jsonb_set(public.seattle_cup_guided_snapshot_v1(),'{version}','2'),'{"schemaVersion":1,"kind":"general_observation","note":"x"}','team');
    RAISE EXCEPTION 'snapshot mismatch accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.scouting_reports (reporter_user_id,reporter_team_key,contributor_role,relationship_context,report_kind,campaign_id,edition_ref,subjects,context,questionnaire_key,questionnaire_version,questionnaire_snapshot,response_payload,visibility)
    VALUES ('10000000-0000-0000-0000-000000000001','interbay','watcher_supporter','watched_match','general_observation','seattle-cup-2026-post-event','seattle-cup:2026','[]','{"matchNos":[]}','seattle-cup-guided-scouting',2,public.seattle_cup_guided_snapshot_v1(),'{"schemaVersion":1,"kind":"general_observation","note":"x"}','team');
    RAISE EXCEPTION 'questionnaire version mismatch accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

SELECT 'harvest security integration passed' AS result;
