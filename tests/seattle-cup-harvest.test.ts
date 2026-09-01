import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { SeattleCupEditionArchive } from '../lib/seattle-cup/archive.ts'
import {
  GUIDED_QUESTIONNAIRE_V1,
  HARVEST_EDITION_REF,
  archivePlayerRefs,
  buildPersonalizedMatches,
  buildScoutingReportDraft,
  canAccessHarvest,
  canAccessScoutingBoard,
  canReviewHarvest,
  canViewHarvestReport,
  contextForArchivedMatch,
  interbayArchivePlayerRefs,
  inviteAcceptanceMode,
  relationshipForPlayerSubjects,
  resolveReporterIdentity,
  subjectsAppearInArchivedMatch,
  validateContributorRoleContext,
  validateGuidedResponse,
  validateQuestionnaireSnapshot,
  type GuidedResponseV1,
} from '../lib/seattle-cup/harvest/domain.ts'

const archive = JSON.parse(readFileSync(new URL('../data/seattle-cup/archive/2026.json', import.meta.url), 'utf8')) as SeattleCupEditionArchive
const players = archivePlayerRefs(archive)
const interbayPlayers = interbayArchivePlayerRefs(archive)

test('contributor capability grants harvest but never the scouting board', () => {
  assert.equal(canAccessHarvest({ contributor: true, scouting: false, admin: false }), true)
  assert.equal(canAccessScoutingBoard({ scouting: false }), false)
  assert.equal(canAccessHarvest({ contributor: false, scouting: false, admin: false }), false)
})

test('captains/admins can review while ordinary contributors cannot', () => {
  assert.equal(canReviewHarvest({ scouting: true, admin: false }), true)
  assert.equal(canReviewHarvest({ scouting: false, admin: true }), true)
  assert.equal(canReviewHarvest({ scouting: false, admin: false }), false)
})

test('existing and new account invite paths remain email-bound', () => {
  assert.equal(inviteAcceptanceMode({ userEmail: 'player@example.com', inviteEmail: 'PLAYER@example.com' }), 'claim')
  assert.equal(inviteAcceptanceMode({ userEmail: null, inviteEmail: 'new@example.com' }), 'signup')
  assert.equal(inviteAcceptanceMode({ userEmail: 'wrong@example.com', inviteEmail: 'right@example.com' }), 'wrong_account')
})

test('archive provides all 25 immediately inviteable Interbay players', () => {
  assert.equal(archive.content.completeness.matches, 60)
  assert.equal(archive.content.completeness.playerAppearances, 192)
  assert.equal(archive.content.completeness.uniquePlayers, 99)
  assert.equal(interbayPlayers.length, 25)
})

test('archive appearances prefill factual match context without reconstruction', () => {
  const reporter = interbayPlayers.find((player) => buildPersonalizedMatches(archive, player.value).length > 0)!
  const match = buildPersonalizedMatches(archive, reporter.value)[0]!
  const context = contextForArchivedMatch(archive, match.matchNo)
  assert.deepEqual(context, { archiveId: HARVEST_EDITION_REF, matchNos: [match.matchNo], round: match.round, format: match.format, course: match.course })
  assert.ok(match.opponents.length > 0)
  assert.ok(match.result)
})

test('ambiguous archive identity requires confirmation instead of silent merge', () => {
  const resolution = resolveReporterIdentity({ canonical: interbayPlayers[0]!, proposed: interbayPlayers[1]!, identityStatus: 'confirmation_required' })
  assert.equal(resolution.requiresConfirmation, true)
  assert.equal(resolution.reporterPlayerRef, null)
  assert.equal(resolution.confirmationCandidates.length, 2)
})

test('one atomic player report preserves structured human assertions, notes, advice, and exact questionnaire', () => {
  const reporter = interbayPlayers[0]!
  const match = buildPersonalizedMatches(archive, reporter.value)[0]!
  const payload = {
    schemaVersion: 1,
    kind: 'player_assessment',
    sections: {
      offTheTee: { overall: 'strength', characteristics: ['distance_stood_out'], note: 'Carried the corner all day.' },
      approachIrons: { overall: 'solid' },
      shortGame: { overall: 'mixed', note: 'Great bunker shot; one heavy chip.' },
      putting: { overall: 'strength', specifics: ['strong_inside_10'] },
      temperament: { labels: ['steady', 'quiet_locked_in'], supportingNote: 'Same pace after losing 15.' },
    },
    finalAdvice: 'Make him hit approaches from the rough.',
    courseHole: { note: 'Right side of 12 removes the angle.', holeNumbers: [12] },
  } as const
  const draft = buildScoutingReportDraft({ reporterUserId: 'user-1', reporterPlayerRef: reporter, contributorRole: 'player', relationshipContext: 'played_against', reportKind: 'player_assessment', subjects: [match.opponents[0]!], context: contextForArchivedMatch(archive, match.matchNo), responsePayload: payload, visibility: 'team' })
  assert.equal(draft.responsePayload, payload)
  assert.equal(draft.questionnaireVersion, 1)
  assert.deepEqual(draft.questionnaireSnapshot, GUIDED_QUESTIONNAIRE_V1)
  assert.deepEqual(draft.provenance, { kind: 'human', channel: 'intel_harvest' })
})

test('guided payload validation rejects unknown taxonomy values', () => {
  const invalid = { schemaVersion: 1, kind: 'player_assessment', sections: { putting: { overall: 'elite' } } } as unknown as GuidedResponseV1
  assert.equal(validateGuidedResponse(invalid), false)
})

test('guided payload rejects unknown sections and extra keys but permits empty optional notes', () => {
  assert.equal(validateGuidedResponse({ schemaVersion: 1, kind: 'player_assessment', sections: { bogus: { anything: 'x' } } }), false)
  assert.equal(validateGuidedResponse({ schemaVersion: 1, kind: 'player_assessment', sections: { putting: { overall: 'solid', extra: true } } }), false)
  assert.equal(validateGuidedResponse({ schemaVersion: 1, kind: 'player_assessment', sections: { putting: { overall: 'didnt_see_enough', note: '' } } }), true)
})

test('questionnaire snapshot preserves ordered human labels and must match key/version exactly', () => {
  assert.equal(GUIDED_QUESTIONNAIRE_V1.sections.putting.specifics[0].label, 'Exceptional / made everything')
  assert.deepEqual(GUIDED_QUESTIONNAIRE_V1.sectionOrder, ['offTheTee', 'approachIrons', 'shortGame', 'putting', 'temperament', 'finalAdvice', 'courseHole'])
  assert.equal(validateQuestionnaireSnapshot(GUIDED_QUESTIONNAIRE_V1, GUIDED_QUESTIONNAIRE_V1.key, 1), true)
  assert.equal(validateQuestionnaireSnapshot({ ...GUIDED_QUESTIONNAIRE_V1, version: 2 }, GUIDED_QUESTIONNAIRE_V1.key, 1), false)
})

test('server role vocabulary prevents forged player and relationship semantics', () => {
  assert.equal(validateContributorRoleContext({ hasArchiveAppearances: true, role: 'player', relationship: 'played_against' }), true)
  assert.equal(validateContributorRoleContext({ hasArchiveAppearances: false, role: 'player', relationship: 'played_against' }), false)
  assert.equal(validateContributorRoleContext({ hasArchiveAppearances: true, role: 'caddie', relationship: 'caddied' }), false)
  assert.equal(validateContributorRoleContext({ hasArchiveAppearances: false, role: 'caddie', relationship: 'watched_match' }), false)
})

test('observer match context only accepts players who appeared in that archived match', () => {
  const match = buildPersonalizedMatches(archive, interbayPlayers[0]!.value)[0]!
  assert.equal(subjectsAppearInArchivedMatch(archive, match.matchNo, [match.opponents[0]!]), true)
  const outsider = players.find((player) => ![...match.opponents, ...match.partners, interbayPlayers[0]!].some((appearance) => appearance.value === player.value))!
  assert.equal(subjectsAppearInArchivedMatch(archive, match.matchNo, [outsider]), false)
})

test('player assessments require exactly one archive subject', () => {
  const payload = { schemaVersion: 1, kind: 'player_assessment', sections: { putting: { overall: 'solid' } } } as const
  assert.throws(() => buildScoutingReportDraft({ reporterUserId: 'u', reporterPlayerRef: null, contributorRole: 'caddie', relationshipContext: 'caddied', reportKind: 'player_assessment', subjects: [], context: { matchNos: [] }, responsePayload: payload, visibility: 'team' }), /exactly one subject/)
})

test('course-only report is atomic and has no player subject', () => {
  const draft = buildScoutingReportDraft({ reporterUserId: 'u', reporterPlayerRef: null, contributorRole: 'watcher_supporter', relationshipContext: 'watched_match', reportKind: 'course_observation', subjects: [], context: { archiveId: HARVEST_EDITION_REF, matchNos: [48], course: 'Jackson Park' }, responsePayload: { schemaVersion: 1, kind: 'course_observation', courseHole: { note: 'Favor the left side on 12.', holeNumbers: [12] } }, visibility: 'team' })
  assert.equal(draft.subjects.length, 0)
  assert.equal(draft.responsePayload.kind, 'course_observation')
})

test('general report supports multiple subjects without splitting source testimony', () => {
  const draft = buildScoutingReportDraft({ reporterUserId: 'u', reporterPlayerRef: null, contributorRole: 'captain', relationshipContext: 'captain_observation', reportKind: 'general_observation', subjects: players.slice(0, 2), context: { archiveId: HARVEST_EDITION_REF, matchNos: [44] }, responsePayload: { schemaVersion: 1, kind: 'general_observation', note: 'Their pair fed off each other.' }, visibility: 'captain' })
  assert.equal(draft.subjects.length, 2)
  assert.equal(draft.visibility, 'captain')
})

test('any player report naming a partner uses captain-sensitive played-with context', () => {
  const reporter = interbayPlayers.find((player) => buildPersonalizedMatches(archive, player.value).some((match) => match.partners.length > 0))!
  const match = buildPersonalizedMatches(archive, reporter.value).find((row) => row.partners.length > 0)!
  assert.equal(relationshipForPlayerSubjects(match, [match.opponents[0]!]), 'played_against')
  assert.equal(relationshipForPlayerSubjects(match, [match.partners[0]!]), 'played_with')
  assert.equal(relationshipForPlayerSubjects(match, [match.opponents[0]!, match.partners[0]!]), 'played_with')
})

test('invited non-player can submit observer testimony without reporterPlayerRef or roster appearance', () => {
  const draft = buildScoutingReportDraft({ reporterUserId: 'observer', reporterPlayerRef: null, contributorRole: 'caddie', relationshipContext: 'caddied', reportKind: 'player_assessment', subjects: [players[0]!], context: contextForArchivedMatch(archive, 44), responsePayload: { schemaVersion: 1, kind: 'player_assessment', sections: { putting: { overall: 'solid', note: 'Watched all 18.' } } }, visibility: 'team' })
  assert.equal(draft.reporterPlayerRef, null)
  assert.equal(draft.relationshipContext, 'caddied')
  assert.equal(draft.context.matchNos[0], 44)
})

test('non-player contributor cannot see other reports or private scouting', () => {
  assert.equal(canViewHarvestReport({ viewerUserId: 'observer', reporterUserId: 'other', visibility: 'team', contributor: true, scouting: false, admin: false }), false)
  assert.equal(canViewHarvestReport({ viewerUserId: 'observer', reporterUserId: 'observer', visibility: 'captain', contributor: true, scouting: false, admin: false }), true)
  assert.equal(canViewHarvestReport({ viewerUserId: 'observer', reporterUserId: 'observer', visibility: 'captain', contributor: false, scouting: false, admin: false }), false)
  assert.equal(canViewHarvestReport({ viewerUserId: 'reviewer', reporterUserId: 'other', visibility: 'team', contributor: false, scouting: true, admin: false }), true)
  assert.equal(canViewHarvestReport({ viewerUserId: 'reviewer', reporterUserId: 'other', visibility: 'captain', contributor: false, scouting: true, admin: false }), false)
  assert.equal(canAccessScoutingBoard({ scouting: false }), false)
})

test('submission model exposes no Observation or availability mutation', () => {
  const draft = buildScoutingReportDraft({ reporterUserId: 'u', reporterPlayerRef: null, contributorRole: 'other_firsthand', relationshipContext: 'other_firsthand', reportKind: 'general_observation', subjects: [], context: { matchNos: [] }, responsePayload: { schemaVersion: 1, kind: 'general_observation', note: 'Firsthand note.' }, visibility: 'team' })
  assert.equal('observation' in draft, false)
  assert.equal('availability' in draft, false)
  assert.equal('readiness' in draft, false)
})

test('finished 2026 context never calls live Golf Genius', () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new Error('live fetch forbidden') }
  try { buildPersonalizedMatches(archive, interbayPlayers[0]!.value); contextForArchivedMatch(archive, 48); assert.equal(calls, 0) } finally { globalThis.fetch = originalFetch }
})

test('migration uses a versioned validated evidence envelope and remains private and append-only', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260901000000_seattle_cup_intel_harvest.sql', import.meta.url), 'utf8')
  assert.match(sql, /contributor_role TEXT NOT NULL/)
  assert.match(sql, /questionnaire_version INTEGER NOT NULL/)
  assert.match(sql, /response_payload JSONB NOT NULL/)
  assert.match(sql, /validate_seattle_cup_guided_report_v1/)
  assert.match(sql, /reporter_player_ref JSONB,/) // optional for non-players
  assert.doesNotMatch(sql, /prompt_key|original_text/)
  assert.match(sql, /Harvest contributors view their own reports/)
  assert.match(sql, /Authorized reviewers read harvest reports by visibility/)
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON public\.scouting_reports FROM authenticated/)
  assert.doesNotMatch(sql, /FOR INSERT\s+WITH CHECK/)
  assert.doesNotMatch(sql, /'relayed'/)
  assert.doesNotMatch(sql, /CREATE TABLE public\.observations/i)
})

test('invite lifecycle actions scope resend/revoke to pending IGC campaign capability and retain report history', () => {
  const harvestActions = readFileSync(new URL('../app/intel-harvest-admin-actions.ts', import.meta.url), 'utf8')
  const scoutingActions = readFileSync(new URL('../app/scouting-admin-actions.ts', import.meta.url), 'utf8')
  assert.match(harvestActions, /\.eq\('campaign_id', HARVEST_CAMPAIGN_ID\)/)
  assert.match(harvestActions, /\.eq\('club_id', clubId\)/)
  assert.match(harvestActions, /\.eq\('feature_key', HARVEST_FEATURE_KEY\)/)
  assert.match(harvestActions, /\.eq\('status', 'pending'\)/)
  assert.match(harvestActions, /feature_entitlements/)
  assert.doesNotMatch(harvestActions, /from\('scouting_reports'\).*delete/s)
  assert.match(scoutingActions, /\.eq\('feature_key', SCOUTING_FEATURE_KEY\)/)
  assert.match(scoutingActions, /\.eq\('status', 'pending'\)/)
})
