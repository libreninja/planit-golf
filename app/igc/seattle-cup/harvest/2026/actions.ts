'use server'

import { revalidatePath } from 'next/cache'
import { requireHarvestAccess } from '@/lib/seattle-cup/harvest/access'
import { loadSeattleCup2026Archive } from '@/lib/seattle-cup/harvest/archive-context'
import {
  archivePlayerRefs,
  buildPersonalizedMatches,
  buildScoutingReportDraft,
  contextForArchivedMatch,
  relationshipForPlayerSubjects,
  reportVisibilityForSubmission,
  subjectsAppearInArchivedMatch,
  validateContributorRoleContext,
  type AssessmentLevel,
  type ContributorRole,
  type GuidedResponseV1,
  type OffTeeCharacteristic,
  type PuttingSpecific,
  type RelationshipContext,
  type ReportKind,
  type ReportVisibility,
  type TemperamentLabel,
} from '@/lib/seattle-cup/harvest/domain'
import { confirmParticipantIdentity, loadContributorHarvestSession, markHarvestComplete } from '@/lib/seattle-cup/harvest/repository'
import { createServiceClient } from '@/lib/supabase/service'

const HARVEST_PATH = '/igc/seattle-cup/harvest/2026'
const roles = new Set<ContributorRole>(['player', 'caddie', 'captain', 'watcher_supporter', 'other_firsthand'])
const relationships = new Set<RelationshipContext>(['played_against', 'played_with', 'caddied', 'watched_match', 'watched_player', 'prior_golf_experience', 'captain_observation', 'other_firsthand'])
const reportKinds = new Set<ReportKind>(['player_assessment', 'course_observation', 'general_observation'])

function str(formData: FormData, key: string): string { return String(formData.get(key) ?? '') }
function optionalText(formData: FormData, key: string): string | undefined {
  const value = str(formData, key)
  return value.trim() ? value : undefined
}
function stringList<T extends string>(formData: FormData, key: string): T[] {
  return formData.getAll(key).map(String).filter(Boolean) as T[]
}
function numberList(value: string): number[] {
  return [...new Set(value.split(',').map((part) => Number(part.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= 18))]
}
function rated(formData: FormData, key: string) {
  const overall = optionalText(formData, `${key}Overall`) as AssessmentLevel | undefined
  const note = optionalText(formData, `${key}Note`)
  return overall || note ? { overall, note } : undefined
}

export async function confirmHarvestIdentityAction(formData: FormData) {
  const { user } = await requireHarvestAccess()
  await confirmParticipantIdentity(user, str(formData, 'ggMemberCardId'))
  revalidatePath(HARVEST_PATH)
}

export async function submitGuidedScoutingReportAction(formData: FormData) {
  const { user } = await requireHarvestAccess()
  const session = await loadContributorHarvestSession(user)
  const archive = loadSeattleCup2026Archive()
  const requestedRole = str(formData, 'contributorRole') as ContributorRole
  const role = session.participant.contributor_role
  let relationship = str(formData, 'relationshipContext') as RelationshipContext
  const reportKind = str(formData, 'reportKind') as ReportKind
  if (!roles.has(requestedRole) || requestedRole !== role) throw new Error('Contributor role does not match this invitation')
  if (!relationships.has(relationship) || !reportKinds.has(reportKind)) throw new Error('Choose valid contributor and firsthand context')

  const matchNoRaw = Number(str(formData, 'matchNo'))
  const matchNo = Number.isInteger(matchNoRaw) && matchNoRaw > 0 ? matchNoRaw : undefined
  let context = contextForArchivedMatch(archive, matchNo)
  const holes = numberList(str(formData, 'holeNumbers'))
  const selectedCourse = optionalText(formData, 'course')
  const allowedCourses = new Set(archive.content.schedule.map((round) => round.course))
  if (selectedCourse && !allowedCourses.has(selectedCourse)) throw new Error('Choose a course from the 2026 archive')
  if (!context.course && selectedCourse) context = { ...context, course: selectedCourse }
  if (holes.length > 0) context = { ...context, holeNumbers: holes }

  const refsById = new Map(archivePlayerRefs(archive).map((ref) => [ref.value, ref]))
  const subjects = stringList<string>(formData, 'subjectCardIds').map((id) => {
    const subject = refsById.get(id)
    if (!subject) throw new Error('Choose a player from the 2026 archive')
    return subject
  }).filter((subject, index, all) => all.findIndex((row) => row.value === subject.value) === index)

  if (matchNo != null && !subjectsAppearInArchivedMatch(archive, matchNo, subjects)) {
    throw new Error('Every selected player must appear in the archived match')
  }

  if (role === 'player') {
    if (!session.reporterPlayerRef) throw new Error('A player contribution requires a confirmed archive identity')
    if (session.requiresIdentityConfirmation) throw new Error('Confirm your player identity before submitting a match report')
    const match = buildPersonalizedMatches(archive, session.reporterPlayerRef.value).find((row) => row.matchNo === matchNo)
    if (!match) throw new Error('That match is not one of your archived appearances')
    const subjectIsOpponent = subjects.some((subject) => match.opponents.some((opponent) => opponent.value === subject.value))
    const subjectIsPartner = subjects.some((subject) => match.partners.some((partner) => partner.value === subject.value))
    if (reportKind === 'player_assessment' && !subjectIsOpponent && !subjectIsPartner) {
      throw new Error('Choose an opponent or partner from that archived match')
    }
    // Any report that includes a teammate is captain-sensitive. This keeps a
    // mixed pair/opponent general note from becoming TEAM-visible merely
    // because it also names an opponent.
    relationship = relationshipForPlayerSubjects(match, subjects)
  }
  if (!validateContributorRoleContext({ hasArchiveAppearances: session.matches.length > 0, role, relationship })) throw new Error('Contributor role and relationship do not match')

  let responsePayload: GuidedResponseV1
  if (reportKind === 'player_assessment') {
    const offTheTee = rated(formData, 'offTheTee')
    const characteristics = stringList<OffTeeCharacteristic>(formData, 'offTeeCharacteristics')
    const putting = rated(formData, 'putting')
    const specifics = stringList<PuttingSpecific>(formData, 'puttingSpecifics')
    const temperamentLabels = stringList<TemperamentLabel>(formData, 'temperamentLabels')
    const temperamentNote = optionalText(formData, 'temperamentNote')
    responsePayload = {
      schemaVersion: 1,
      kind: 'player_assessment',
      sections: {
        offTheTee: offTheTee || characteristics.length ? { ...offTheTee, characteristics: characteristics.length ? characteristics : undefined } : undefined,
        approachIrons: rated(formData, 'approachIrons'),
        shortGame: rated(formData, 'shortGame'),
        putting: putting || specifics.length ? { ...putting, specifics: specifics.length ? specifics : undefined } : undefined,
        temperament: temperamentLabels.length || temperamentNote ? { labels: temperamentLabels.length ? temperamentLabels : undefined, supportingNote: temperamentNote } : undefined,
      },
      finalAdvice: optionalText(formData, 'finalAdvice'),
      courseHole: optionalText(formData, 'courseNote') ? { note: optionalText(formData, 'courseNote')!, holeNumbers: holes.length ? holes : undefined } : undefined,
    }
  } else if (reportKind === 'course_observation') {
    responsePayload = { schemaVersion: 1, kind: 'course_observation', courseHole: { note: str(formData, 'courseNote'), holeNumbers: holes.length ? holes : undefined } }
  } else {
    responsePayload = { schemaVersion: 1, kind: 'general_observation', note: str(formData, 'generalNote'), finalAdvice: optionalText(formData, 'finalAdvice') }
  }

  const requestedVisibility = str(formData, 'visibility') as ReportVisibility
  if (requestedVisibility !== 'team' && requestedVisibility !== 'captain') throw new Error('Choose a valid report audience')
  const visibility = reportVisibilityForSubmission({ relationship, subjects, requestedVisibility })
  const draft = buildScoutingReportDraft({
    reporterUserId: user.id,
    reporterPlayerRef: session.reporterPlayerRef,
    contributorRole: role,
    relationshipContext: relationship,
    reportKind,
    subjects,
    context,
    responsePayload,
    visibility,
  })
  const service = createServiceClient()
  const { error } = await service.from('scouting_reports').insert({
    reporter_user_id: draft.reporterUserId,
    reporter_player_ref: draft.reporterPlayerRef,
    reporter_team_key: draft.reporterTeamKey,
    contributor_role: draft.contributorRole,
    relationship_context: draft.relationshipContext,
    report_kind: draft.reportKind,
    campaign_id: draft.campaignId,
    edition_ref: draft.editionRef,
    subjects: draft.subjects,
    context: draft.context,
    questionnaire_key: draft.questionnaireKey,
    questionnaire_version: draft.questionnaireVersion,
    questionnaire_snapshot: draft.questionnaireSnapshot,
    response_payload: draft.responsePayload,
    visibility: draft.visibility,
    provenance: draft.provenance,
  })
  if (error) throw error
  revalidatePath(HARVEST_PATH)
}

export async function completeHarvestAction(formData: FormData) {
  const { user } = await requireHarvestAccess()
  const reportCount = Number(str(formData, 'reportCount'))
  const session = await loadContributorHarvestSession(user)
  await markHarvestComplete(user, Math.max(session.ownReports.length, Number.isFinite(reportCount) ? reportCount : 0))
  revalidatePath(HARVEST_PATH)
}
