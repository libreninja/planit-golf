import type { SeattleCupEditionArchive } from '../archive.ts'
import type { Match, MatchPlayer, RoundNumber, TeamKey } from '../types.ts'

export const HARVEST_CAMPAIGN_ID = 'seattle-cup-2026-post-event'
export const HARVEST_EDITION_REF = 'seattle-cup:2026'
export const HARVEST_FEATURE_KEY = 'seattle_cup_intel_contribute'
export const HARVEST_CAPTAIN_FEATURE_KEY = 'seattle_cup_intel_captain'
export const HARVEST_TEAM_KEY: TeamKey = 'interbay'
export const GUIDED_QUESTIONNAIRE_KEY = 'seattle-cup-guided-scouting'
export const GUIDED_QUESTIONNAIRE_VERSION = 1

export type ReportVisibility = 'team' | 'captain'
export type ReportKind = 'player_assessment' | 'course_observation' | 'general_observation'
export type ContributorRole = 'player' | 'caddie' | 'captain' | 'watcher_supporter' | 'other_firsthand'
export type RelationshipContext =
  | 'played_against' | 'played_with' | 'caddied' | 'watched_match' | 'watched_player'
  | 'prior_golf_experience' | 'captain_observation' | 'other_firsthand'
export type AssessmentLevel = 'strength' | 'solid' | 'mixed' | 'struggled' | 'didnt_see_enough'
export type OffTeeCharacteristic = 'missed_left' | 'missed_right' | 'both_ways' | 'distance_stood_out' | 'accuracy_stood_out'
export type PuttingSpecific = 'exceptional' | 'strong_inside_10' | 'lag_putting_stood_out' | 'short_putt_struggles'
export type TemperamentLabel = 'ice_cold' | 'steady' | 'rides_momentum' | 'hot_head' | 'club_thrower' | 'checks_out' | 'talker' | 'quiet_locked_in' | 'didnt_see_enough'

export interface PlayerExternalRef {
  system: 'golfgenius'
  kind: 'member_card'
  value: string
  displayName: string
  teamKey: TeamKey | null
}

export interface ScoutingReportContext {
  archiveId?: string
  matchNos: number[]
  round?: RoundNumber
  format?: string
  course?: string
  holeNumbers?: number[]
}

interface RatedSection {
  overall?: AssessmentLevel
  note?: string
}

export interface PlayerAssessmentResponseV1 {
  schemaVersion: 1
  kind: 'player_assessment'
  sections: {
    offTheTee?: RatedSection & { characteristics?: OffTeeCharacteristic[] }
    approachIrons?: RatedSection
    shortGame?: RatedSection
    putting?: RatedSection & { specifics?: PuttingSpecific[] }
    temperament?: { labels?: TemperamentLabel[]; supportingNote?: string }
  }
  finalAdvice?: string
  courseHole?: { note: string; holeNumbers?: number[] }
}

export interface CourseObservationResponseV1 {
  schemaVersion: 1
  kind: 'course_observation'
  courseHole: { note: string; holeNumbers?: number[] }
}

export interface GeneralObservationResponseV1 {
  schemaVersion: 1
  kind: 'general_observation'
  note: string
  finalAdvice?: string
}

export type GuidedResponseV1 = PlayerAssessmentResponseV1 | CourseObservationResponseV1 | GeneralObservationResponseV1

export const GUIDED_QUESTIONNAIRE_V1 = {
  key: GUIDED_QUESTIONNAIRE_KEY,
  version: GUIDED_QUESTIONNAIRE_VERSION,
  reportKinds: [
    { key: 'player_assessment', label: 'Player assessment' },
    { key: 'course_observation', label: 'Course / hole observation' },
    { key: 'general_observation', label: 'General or multi-player observation' },
  ],
  sectionOrder: ['offTheTee', 'approachIrons', 'shortGame', 'putting', 'temperament', 'finalAdvice', 'courseHole'],
  assessmentHelperText: 'Choose only if you saw enough',
  assessmentOptions: [
    { key: 'strength', label: 'Strength' },
    { key: 'solid', label: 'Solid' },
    { key: 'mixed', label: 'Mixed' },
    { key: 'struggled', label: 'Struggled' },
    { key: 'didnt_see_enough', label: "Didn't see enough" },
  ],
  sections: {
    offTheTee: {
      prompt: 'Off the tee',
      helperText: 'Choose only what you personally observed.',
      characteristics: [
        { key: 'missed_left', label: 'Missed mostly left' },
        { key: 'missed_right', label: 'Missed mostly right' },
        { key: 'both_ways', label: 'Both ways' },
        { key: 'distance_stood_out', label: 'Distance stood out' },
        { key: 'accuracy_stood_out', label: 'Accuracy stood out' },
      ],
      notePrompt: 'Optional note',
    },
    approachIrons: { prompt: 'Approach / irons', notePrompt: 'Optional note' },
    shortGame: { prompt: 'Short game', notePrompt: 'Optional note' },
    putting: {
      prompt: 'Putting',
      specifics: [
        { key: 'exceptional', label: 'Exceptional / made everything' },
        { key: 'strong_inside_10', label: 'Strong inside ~10 feet' },
        { key: 'lag_putting_stood_out', label: 'Lag putting stood out' },
        { key: 'short_putt_struggles', label: 'Short-putt struggles' },
      ],
      notePrompt: 'Optional note',
    },
    temperament: {
      prompt: 'On-course temperament',
      helperText: 'Private Interbay golf shorthand based on what you observed.',
      labels: [
        { key: 'ice_cold', label: 'Ice cold' },
        { key: 'steady', label: 'Steady' },
        { key: 'rides_momentum', label: 'Rides momentum' },
        { key: 'hot_head', label: 'Hot head' },
        { key: 'club_thrower', label: 'Club thrower' },
        { key: 'checks_out', label: 'Checks out' },
        { key: 'talker', label: 'Talker' },
        { key: 'quiet_locked_in', label: 'Quiet / locked in' },
        { key: 'didnt_see_enough', label: "Didn't see enough" },
      ],
      supportingNotePrompt: 'What did you see? Especially useful for stronger labels.',
    },
    finalAdvice: { prompt: 'What would you tell an Interbay teammate playing this person next year?' },
    courseHole: { prompt: 'Any course or hole lesson worth saving?', holePrompt: 'Hole numbers, e.g. 4, 12, 18' },
    general: { prompt: 'What did you see? What should we know?', advicePrompt: 'Optional teammate advice' },
  },
} as const

export interface ScoutingReportDraft {
  reporterUserId: string
  reporterPlayerRef: PlayerExternalRef | null
  reporterTeamKey: TeamKey
  contributorRole: ContributorRole
  relationshipContext: RelationshipContext
  reportKind: ReportKind
  campaignId: typeof HARVEST_CAMPAIGN_ID
  editionRef: typeof HARVEST_EDITION_REF
  subjects: PlayerExternalRef[]
  context: ScoutingReportContext
  questionnaireKey: typeof GUIDED_QUESTIONNAIRE_KEY
  questionnaireVersion: typeof GUIDED_QUESTIONNAIRE_VERSION
  questionnaireSnapshot: typeof GUIDED_QUESTIONNAIRE_V1
  responsePayload: GuidedResponseV1
  visibility: ReportVisibility
  provenance: { kind: 'human'; channel: 'intel_harvest' }
}

export interface HarvestMatchContext {
  matchNo: number
  round: RoundNumber
  format: string
  course: string
  partners: PlayerExternalRef[]
  opponents: PlayerExternalRef[]
  result: string
}

export interface ReporterIdentityResolution {
  reporterPlayerRef: PlayerExternalRef | null
  confirmationCandidates: PlayerExternalRef[]
  requiresConfirmation: boolean
}

const assessmentLevels = new Set<AssessmentLevel>(GUIDED_QUESTIONNAIRE_V1.assessmentOptions.map((option) => option.key))
const offTeeCharacteristics = new Set<OffTeeCharacteristic>(GUIDED_QUESTIONNAIRE_V1.sections.offTheTee.characteristics.map((option) => option.key))
const puttingSpecifics = new Set<PuttingSpecific>(GUIDED_QUESTIONNAIRE_V1.sections.putting.specifics.map((option) => option.key))
const temperamentLabels = new Set<TemperamentLabel>(GUIDED_QUESTIONNAIRE_V1.sections.temperament.labels.map((option) => option.key))

function validOptionalText(value: unknown): value is string | undefined {
  return value == null || typeof value === 'string'
}

function validHoles(value: unknown): value is number[] | undefined {
  return value == null || (Array.isArray(value) && value.every((hole) => Number.isInteger(hole) && hole >= 1 && hole <= 18))
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function validRating(section: unknown, allowedKeys: readonly string[]): boolean {
  if (section == null) return true
  if (!isObject(section) || !hasOnlyKeys(section, allowedKeys)) return false
  return (section.overall == null || (typeof section.overall === 'string' && assessmentLevels.has(section.overall as AssessmentLevel)))
    && validOptionalText(section.note)
}

function validEnumArray<T extends string>(value: unknown, allowed: Set<T>): value is T[] | undefined {
  return value == null || (Array.isArray(value) && value.every((item) => typeof item === 'string' && allowed.has(item as T)))
}

function hasSectionEvidence(section: object | undefined): boolean {
  return !!section && Object.values(section).some((value) => Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.trim().length > 0)
}

export function validateGuidedResponse(response: unknown): response is GuidedResponseV1 {
  if (!isObject(response) || response.schemaVersion !== 1 || typeof response.kind !== 'string') return false
  if (response.kind === 'course_observation') {
    if (!hasOnlyKeys(response, ['schemaVersion', 'kind', 'courseHole']) || !isObject(response.courseHole)) return false
    return hasOnlyKeys(response.courseHole, ['note', 'holeNumbers'])
      && typeof response.courseHole.note === 'string' && response.courseHole.note.trim().length > 0
      && validHoles(response.courseHole.holeNumbers)
  }
  if (response.kind === 'general_observation') {
    return hasOnlyKeys(response, ['schemaVersion', 'kind', 'note', 'finalAdvice'])
      && typeof response.note === 'string' && response.note.trim().length > 0
      && validOptionalText(response.finalAdvice)
  }
  if (response.kind !== 'player_assessment'
    || !hasOnlyKeys(response, ['schemaVersion', 'kind', 'sections', 'finalAdvice', 'courseHole'])
    || !isObject(response.sections)
    || !hasOnlyKeys(response.sections, ['offTheTee', 'approachIrons', 'shortGame', 'putting', 'temperament'])) return false
  const sections = response.sections
  if (!validRating(sections.offTheTee, ['overall', 'note', 'characteristics'])
    || !validRating(sections.approachIrons, ['overall', 'note'])
    || !validRating(sections.shortGame, ['overall', 'note'])
    || !validRating(sections.putting, ['overall', 'note', 'specifics'])) return false
  const offTheTee = isObject(sections.offTheTee) ? sections.offTheTee : undefined
  const putting = isObject(sections.putting) ? sections.putting : undefined
  const temperament = isObject(sections.temperament) ? sections.temperament : undefined
  if (!validEnumArray(offTheTee?.characteristics, offTeeCharacteristics)
    || !validEnumArray(putting?.specifics, puttingSpecifics)) return false
  if (sections.temperament != null && (!temperament || !hasOnlyKeys(temperament, ['labels', 'supportingNote']))) return false
  if (!validEnumArray(temperament?.labels, temperamentLabels)
    || !validOptionalText(temperament?.supportingNote)
    || !validOptionalText(response.finalAdvice)) return false
  if (response.courseHole != null) {
    if (!isObject(response.courseHole) || !hasOnlyKeys(response.courseHole, ['note', 'holeNumbers'])
      || typeof response.courseHole.note !== 'string' || !response.courseHole.note.trim()
      || !validHoles(response.courseHole.holeNumbers)) return false
  }
  return Object.values(sections).some((section) => isObject(section) && hasSectionEvidence(section))
    || (typeof response.finalAdvice === 'string' && response.finalAdvice.trim().length > 0)
    || response.courseHole != null
}

export function validateQuestionnaireSnapshot(snapshot: unknown, key: string, version: number): boolean {
  return key === GUIDED_QUESTIONNAIRE_KEY && version === GUIDED_QUESTIONNAIRE_VERSION
    && JSON.stringify(snapshot) === JSON.stringify(GUIDED_QUESTIONNAIRE_V1)
}

export function buildScoutingReportDraft(input: {
  reporterUserId: string
  reporterPlayerRef: PlayerExternalRef | null
  contributorRole: ContributorRole
  relationshipContext: RelationshipContext
  reportKind: ReportKind
  subjects: PlayerExternalRef[]
  context: ScoutingReportContext
  responsePayload: GuidedResponseV1
  visibility: ReportVisibility
}): ScoutingReportDraft {
  if (input.responsePayload.kind !== input.reportKind || !validateGuidedResponse(input.responsePayload)) throw new Error('Invalid guided report response')
  if (input.reportKind === 'player_assessment' && input.subjects.length !== 1) throw new Error('A player assessment requires exactly one subject')
  if (input.reportKind === 'course_observation' && input.subjects.length !== 0) throw new Error('A course observation cannot have player subjects')
  return {
    ...input,
    reporterTeamKey: HARVEST_TEAM_KEY,
    campaignId: HARVEST_CAMPAIGN_ID,
    editionRef: HARVEST_EDITION_REF,
    questionnaireKey: GUIDED_QUESTIONNAIRE_KEY,
    questionnaireVersion: GUIDED_QUESTIONNAIRE_VERSION,
    questionnaireSnapshot: GUIDED_QUESTIONNAIRE_V1,
    provenance: { kind: 'human', channel: 'intel_harvest' },
  }
}

export function displayPlayerName(name: string): string {
  const [last, ...rest] = name.split(',').map((part) => part.trim())
  return rest.length > 0 ? `${rest.join(' ')} ${last}`.trim() : name.trim()
}

export function playerExternalRef(player: MatchPlayer): PlayerExternalRef | null {
  if (!player.ggMemberCardId) return null
  return { system: 'golfgenius', kind: 'member_card', value: player.ggMemberCardId, displayName: displayPlayerName(player.name), teamKey: player.teamKey }
}

export function allArchiveMatches(archive: SeattleCupEditionArchive): Match[] {
  return archive.content.rounds.flatMap((round) => round.matches)
}

export function archivePlayerRefs(archive: SeattleCupEditionArchive): PlayerExternalRef[] {
  const refs = new Map<string, PlayerExternalRef>()
  for (const match of allArchiveMatches(archive)) for (const player of [...match.playersA, ...match.playersB]) {
    const ref = playerExternalRef(player)
    if (ref) refs.set(ref.value, ref)
  }
  return [...refs.values()].sort((a, b) => a.displayName.localeCompare(b.displayName))
}

export function interbayArchivePlayerRefs(archive: SeattleCupEditionArchive): PlayerExternalRef[] {
  return archivePlayerRefs(archive).filter((player) => player.teamKey === HARVEST_TEAM_KEY)
}

export function findArchivePlayer(archive: SeattleCupEditionArchive, ggMemberCardId: string): PlayerExternalRef | null {
  return archivePlayerRefs(archive).find((player) => player.value === ggMemberCardId) ?? null
}

export function resolveReporterIdentity(input: { canonical: PlayerExternalRef | null; proposed: PlayerExternalRef | null; identityStatus: 'canonical' | 'confirmation_required' | 'confirmed' | 'not_applicable' }): ReporterIdentityResolution {
  const candidates = [input.canonical, input.proposed]
    .filter((candidate): candidate is PlayerExternalRef => candidate != null)
    .filter((candidate, index, all) => all.findIndex((row) => row.value === candidate.value) === index)
  const conflicting = input.canonical != null && input.proposed != null && input.canonical.value !== input.proposed.value
  const requiresConfirmation = input.identityStatus === 'confirmation_required' || conflicting
  return { reporterPlayerRef: requiresConfirmation ? null : (input.canonical ?? input.proposed), confirmationCandidates: candidates, requiresConfirmation }
}

function resultForSide(match: Match, side: 'A' | 'B'): string {
  const own = side === 'A' ? match.pointsA : match.pointsB
  const other = side === 'A' ? match.pointsB : match.pointsA
  if (own == null || other == null) return match.result ?? 'Result unavailable'
  const outcome = own === other ? 'Halved' : own > other ? 'Won' : 'Lost'
  return match.result ? `${outcome} · ${match.result}` : outcome
}

export function buildPersonalizedMatches(archive: SeattleCupEditionArchive, reporterCardId: string): HarvestMatchContext[] {
  const contexts: HarvestMatchContext[] = []
  for (const match of allArchiveMatches(archive)) {
    const onA = match.playersA.some((player) => player.ggMemberCardId === reporterCardId)
    const onB = match.playersB.some((player) => player.ggMemberCardId === reporterCardId)
    if (!onA && !onB) continue
    const ownPlayers = onA ? match.playersA : match.playersB
    const otherPlayers = onA ? match.playersB : match.playersA
    contexts.push({
      matchNo: match.matchNo, round: match.round, format: match.format, course: match.course,
      partners: ownPlayers.filter((player) => player.ggMemberCardId !== reporterCardId).map(playerExternalRef).filter((player): player is PlayerExternalRef => player != null),
      opponents: otherPlayers.map(playerExternalRef).filter((player): player is PlayerExternalRef => player != null),
      result: resultForSide(match, onA ? 'A' : 'B'),
    })
  }
  return contexts.sort((a, b) => a.matchNo - b.matchNo)
}

export function contextForArchivedMatch(archive: SeattleCupEditionArchive, matchNo?: number): ScoutingReportContext {
  if (matchNo == null) return { archiveId: HARVEST_EDITION_REF, matchNos: [] }
  const match = allArchiveMatches(archive).find((row) => row.matchNo === matchNo)
  if (!match) throw new Error('Unknown archived match')
  return { archiveId: HARVEST_EDITION_REF, matchNos: [match.matchNo], round: match.round, format: match.format, course: match.course }
}

const relationshipsByRole: Record<ContributorRole, readonly RelationshipContext[]> = {
  player: ['played_against', 'played_with'],
  caddie: ['caddied'],
  captain: ['captain_observation'],
  watcher_supporter: ['watched_match', 'watched_player'],
  other_firsthand: ['prior_golf_experience', 'other_firsthand'],
}

export function validateContributorRoleContext(input: {
  hasArchiveAppearances: boolean
  role: ContributorRole
  relationship: RelationshipContext
}): boolean {
  if (input.hasArchiveAppearances !== (input.role === 'player')) return false
  return relationshipsByRole[input.role].includes(input.relationship)
}

export function subjectsAppearInArchivedMatch(
  archive: SeattleCupEditionArchive,
  matchNo: number,
  subjects: PlayerExternalRef[],
): boolean {
  const match = allArchiveMatches(archive).find((row) => row.matchNo === matchNo)
  if (!match) return false
  const appearances = new Set([...match.playersA, ...match.playersB].map((player) => player.ggMemberCardId).filter(Boolean))
  return subjects.every((subject) => appearances.has(subject.value))
}

export function relationshipForPlayerSubjects(
  match: Pick<HarvestMatchContext, 'partners'>,
  subjects: PlayerExternalRef[],
): Extract<RelationshipContext, 'played_against' | 'played_with'> {
  const partnerIds = new Set(match.partners.map((partner) => partner.value))
  return subjects.some((subject) => partnerIds.has(subject.value)) ? 'played_with' : 'played_against'
}

export function canAccessHarvest(input: { contributor: boolean; scouting: boolean; captain: boolean }): boolean {
  return input.contributor || input.scouting || input.captain
}
export function canAccessScoutingBoard(input: { scouting: boolean }): boolean { return input.scouting }
export function canReviewHarvest(input: { scouting: boolean; captain: boolean }): boolean { return input.scouting || input.captain }
export function canViewHarvestReport(input: { viewerUserId: string; reporterUserId: string; visibility: ReportVisibility; contributor: boolean; scouting: boolean; captain: boolean }): boolean {
  if (input.viewerUserId === input.reporterUserId) return input.contributor || input.scouting || input.captain
  return input.captain || (input.visibility === 'team' && input.scouting)
}
export function inviteAcceptanceMode(input: { userEmail: string | null; inviteEmail: string }): 'signup' | 'claim' | 'wrong_account' {
  if (!input.userEmail) return 'signup'
  return input.userEmail.trim().toLowerCase() === input.inviteEmail.trim().toLowerCase() ? 'claim' : 'wrong_account'
}
