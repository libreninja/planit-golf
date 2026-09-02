import Link from 'next/link'
import {
  createIntelHarvestInvite,
  revokeIntelHarvestContributor,
  resendIntelHarvestInvite,
  revokeIntelHarvestInvite,
} from '@/app/intel-harvest-admin-actions'
import { Button } from '@/components/ui/button'
import { requireHarvestReviewOrManagerAccess } from '@/lib/seattle-cup/harvest/access'
import { loadSeattleCup2026Archive } from '@/lib/seattle-cup/harvest/archive-context'
import {
  HARVEST_CAMPAIGN_ID,
  HARVEST_FEATURE_KEY,
  interbayArchivePlayerRefs,
  type PlayerExternalRef,
} from '@/lib/seattle-cup/harvest/domain'
import type { HarvestParticipantRow, StoredScoutingReport } from '@/lib/seattle-cup/harvest/repository'
import { getIgcClubId } from '@/lib/scouting-access'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const relationshipLabels: Record<string, string> = {
  played_against: 'Played against',
  played_with: 'Played with',
  caddied: 'Caddied',
  watched_match: 'Watched match',
  watched_player: 'Watched player',
  prior_golf_experience: 'Prior golf experience',
  captain_observation: 'Captain observation',
  other_firsthand: 'Other firsthand',
}

function statusLabel(participant: HarvestParticipantRow, reportCount: number): string {
  if (participant.campaign_status === 'completed') return 'Completed'
  if (participant.campaign_status === 'skipped') return 'Completed / skipped'
  if (reportCount > 0) return 'Submitted'
  return participant.campaign_status[0]!.toUpperCase() + participant.campaign_status.slice(1)
}

function contextLine(report: StoredScoutingReport): string {
  const relationship = relationshipLabels[report.relationship_context] ?? report.relationship_context
  const facts = [
    Array.isArray(report.context.matchNos) && report.context.matchNos.length > 0 ? `Match ${report.context.matchNos.join(', ')}` : null,
    report.context.round ? `Round ${report.context.round}` : null,
    report.context.format ?? null,
    report.context.course ?? null,
    report.context.holeNumbers?.length ? `Holes ${report.context.holeNumbers.join(', ')}` : null,
  ].filter((value): value is string => !!value)
  return [relationship, ...facts].join(' · ')
}

function snapshotLabels(report: StoredScoutingReport): Map<string, string> {
  const labels = new Map<string, string>()
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!value || typeof value !== 'object') return
    const row = value as Record<string, unknown>
    if (typeof row.key === 'string' && typeof row.label === 'string') labels.set(row.key, row.label)
    for (const nested of Object.values(row)) visit(nested)
  }
  visit(report.questionnaire_snapshot)
  return labels
}

function reportSummary(report: StoredScoutingReport): string[] {
  const payload = report.response_payload
  const labels = snapshotLabels(report)
  const label = (key: string) => labels.get(key) ?? key.replaceAll('_', ' ')
  if (payload.kind === 'course_observation') return [payload.courseHole.note]
  if (payload.kind === 'general_observation') return [payload.note, payload.finalAdvice].filter((value): value is string => !!value)
  const lines: string[] = []
  const sectionLabels: Record<string, string> = { offTheTee: 'Off the tee', approachIrons: 'Approach / irons', shortGame: 'Short game', putting: 'Putting' }
  for (const [key, section] of Object.entries(payload.sections)) {
    if (!section || key === 'temperament') continue
    const rated = section as { overall?: string; note?: string; characteristics?: string[]; specifics?: string[] }
    lines.push(`${sectionLabels[key] ?? key}: ${[rated.overall ? label(rated.overall) : null, ...(rated.characteristics ?? []).map(label), ...(rated.specifics ?? []).map(label), rated.note].filter(Boolean).join(' · ')}`)
  }
  if (payload.sections.temperament) lines.push(`Temperament: ${[...(payload.sections.temperament.labels ?? []).map(label), payload.sections.temperament.supportingNote].filter(Boolean).join(' · ')}`)
  if (payload.finalAdvice) lines.push(`Advice: ${payload.finalAdvice}`)
  if (payload.courseHole) lines.push(`Course / holes: ${payload.courseHole.note}`)
  return lines
}

export default async function HarvestReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ visibility?: string; kind?: string }>
}) {
  const access = await requireHarvestReviewOrManagerAccess()
  const filters = await searchParams
  const service = createServiceClient()
  const userClient = await createClient()
  const clubId = await getIgcClubId()
  const [{ data: reportsRaw, error: reportsError }, { data: participantsRaw, error: participantsError }, { data: invitesRaw }] = await Promise.all([
    userClient.from('scouting_reports').select('*').eq('campaign_id', HARVEST_CAMPAIGN_ID).order('contributed_at', { ascending: false }),
    service.from('intel_harvest_participants').select('*').eq('campaign_id', HARVEST_CAMPAIGN_ID).order('created_at', { ascending: false }),
    service.from('capability_invites').select('id, email, display_name, status, created_at, claimed_at').eq('club_id', clubId).eq('feature_key', HARVEST_FEATURE_KEY).order('created_at', { ascending: false }),
  ])
  if (reportsError) throw reportsError
  if (participantsError) throw participantsError
  const allReports = (reportsRaw ?? []) as StoredScoutingReport[]
  const reports = allReports.filter((report) =>
    (!filters.visibility || report.visibility === filters.visibility)
    && (!filters.kind || report.report_kind === filters.kind),
  )
  const participants = (participantsRaw ?? []) as HarvestParticipantRow[]
  const userIds = [...new Set(participants.map((participant) => participant.user_id).filter((id): id is string => !!id))]
  const { data: profiles } = userIds.length > 0
    ? await service.from('profiles').select('id, email, display_name').in('id', userIds)
    : { data: [] }
  const profileById = new Map((profiles ?? []).map((profile) => [profile.id as string, profile]))
  const participantByUser = new Map(participants.filter((row) => row.user_id).map((row) => [row.user_id!, row]))
  const reportsByUser = new Map<string, number>()
  for (const report of allReports) reportsByUser.set(report.reporter_user_id, (reportsByUser.get(report.reporter_user_id) ?? 0) + 1)
  const summary = {
    invited: participants.length,
    claimed: participants.filter((p) => p.user_id || ['claimed', 'started', 'completed', 'skipped'].includes(p.campaign_status)).length,
    started: participants.filter((p) => ['started', 'completed', 'skipped'].includes(p.campaign_status)).length,
    submitted: [...reportsByUser.keys()].length,
    completed: participants.filter((p) => p.campaign_status === 'completed' || p.campaign_status === 'skipped').length,
  }
  const playerOptions = interbayArchivePlayerRefs(loadSeattleCup2026Archive())
  const pendingInvites = (invitesRaw ?? []).filter((invite) => invite.status === 'pending')

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Private scouting review</p><h1 className="mt-2 text-3xl">Seattle Cup 2026 Reports</h1></div>
        <div className="flex gap-2"><Button asChild variant="outline"><Link href="/api/seattle-cup/harvest/2026/export">Export CSV</Link></Button><Button asChild variant="outline"><Link href="/igc/seattle-cup/harvest/2026">Contribute</Link></Button></div>
      </div>

      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {Object.entries(summary).map(([label, count]) => <div key={label} className="rounded-2xl border border-border bg-white/80 p-4"><div className="text-2xl font-semibold">{count}</div><div className="text-xs capitalize text-muted-foreground">{label}</div></div>)}
      </section>

      {access.captain || access.isAdmin ? <section className="mt-8 rounded-2xl border border-border bg-white/80 p-5">
        <h2 className="text-xl">Invite a contributor</h2>
        <p className="mt-1 text-sm text-muted-foreground">Any email address is allowed. Choose a 2026 player only when proposing a personalized player match; they must confirm it once.</p>
        <form action={createIntelHarvestInvite} className="mt-4 grid gap-3 md:grid-cols-5">
          <input name="email" type="email" required placeholder="email@example.com" className="rounded-xl border border-input bg-white px-3 py-2" />
          <input name="displayName" placeholder="Name (optional)" className="rounded-xl border border-input bg-white px-3 py-2" />
          <select name="ggMemberCardId" defaultValue="" className="rounded-xl border border-input bg-white px-3 py-2">
            <option value="">Observer / caddie / watcher</option>
            {playerOptions.map((player) => <option key={player.value} value={player.value}>{player.displayName} · 2026 player</option>)}
          </select>
          <select name="contributorRole" defaultValue="watcher_supporter" className="rounded-xl border border-input bg-white px-3 py-2">
            <option value="watcher_supporter">Watched / supported</option><option value="caddie">Caddie</option><option value="captain">Captain</option><option value="other_firsthand">Other firsthand</option>
          </select>
          <Button type="submit">Send private invite</Button>
        </form>
        <p className="mt-3 text-xs text-muted-foreground">{playerOptions.length} archived Interbay players are available for personalized invitations; arbitrary non-player invitees are also supported.</p>
      </section> : null}

      {(access.captain || access.isAdmin) && pendingInvites.length > 0 ? (
        <section className="mt-8"><h2 className="text-xl">Pending invites</h2><div className="mt-3 space-y-2">{pendingInvites.map((invite) => <div key={invite.id as string} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-white/70 p-3 text-sm"><div><div className="font-medium">{invite.display_name ?? invite.email}</div><div className="text-xs text-muted-foreground">{invite.email}</div></div><div className="flex gap-2"><form action={resendIntelHarvestInvite}><input type="hidden" name="inviteId" value={invite.id as string} /><Button size="sm" variant="outline">Resend</Button></form><form action={revokeIntelHarvestInvite}><input type="hidden" name="inviteId" value={invite.id as string} /><Button size="sm" variant="outline">Revoke</Button></form></div></div>)}</div></section>
      ) : null}

      <section className="mt-8">
        <h2 className="text-xl">Campaign completion</h2>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-border bg-white/75">
          <table className="w-full text-left text-sm"><thead className="bg-muted/45"><tr><th className="px-4 py-3">Contributor</th><th className="px-4 py-3">Context</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Reports</th><th className="px-4 py-3">Access</th></tr></thead><tbody>{participants.map((participant) => { const profile = participant.user_id ? profileById.get(participant.user_id) : undefined; const player = participant.reporter_player_ref as PlayerExternalRef | null; const count = participant.user_id ? reportsByUser.get(participant.user_id) ?? 0 : 0; const canManage = access.captain || access.isAdmin; return <tr key={participant.id} className="border-t border-border"><td className="px-4 py-3"><div className="font-medium">{profile?.display_name ?? player?.displayName ?? participant.email}</div><div className="text-xs text-muted-foreground">{participant.email}</div></td><td className="px-4 py-3">{participant.contributor_role === 'player' && player ? `2026 player · ${participant.identity_status}` : participant.contributor_role.replaceAll('_', ' ')}</td><td className="px-4 py-3">{statusLabel(participant, count)}</td><td className="px-4 py-3">{count}</td><td className="px-4 py-3">{participant.user_id && canManage ? <form action={revokeIntelHarvestContributor}><input type="hidden" name="userId" value={participant.user_id} /><Button size="sm" variant="outline">Revoke contribution access</Button></form> : participant.user_id ? 'Active' : 'Not claimed'}</td></tr> })}</tbody></table>
        </div>
      </section>

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl">Harvested reports</h2><form className="flex flex-wrap gap-2"><select name="visibility" defaultValue={filters.visibility ?? ''} className="rounded-lg border border-input bg-white px-2 py-1 text-sm"><option value="">All visibility</option><option value="team">Team</option><option value="captain">Captain</option></select><select name="kind" defaultValue={filters.kind ?? ''} className="rounded-lg border border-input bg-white px-2 py-1 text-sm"><option value="">All report types</option><option value="player_assessment">Player assessment</option><option value="course_observation">Course / hole</option><option value="general_observation">General / multi-player</option></select><Button type="submit" size="sm" variant="outline">Filter</Button></form></div>
        {reports.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No reports match this view yet.</p> : <div className="mt-3 space-y-4">{reports.map((report) => { const participant = participantByUser.get(report.reporter_user_id); const profile = profileById.get(report.reporter_user_id); const subjects = (report.subjects ?? []).map((subject) => subject.displayName).join(', '); return <article key={report.id} className="rounded-2xl border border-border bg-white/85 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-semibold">{profile?.display_name ?? participant?.reporter_player_ref?.displayName ?? participant?.email ?? report.reporter_user_id}</div><div className="text-xs text-muted-foreground">{report.contributor_role.replaceAll('_', ' ')} · {contextLine(report)}{subjects ? ` · ${subjects}` : ''}</div></div><div className="text-right text-xs text-muted-foreground"><div className={report.visibility === 'captain' ? 'font-semibold text-amber-700' : ''}>{report.visibility === 'captain' ? 'Captain only' : 'Team'}</div><time>{new Date(report.contributed_at).toLocaleString()}</time></div></div><div className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">{report.report_kind.replaceAll('_', ' ')} · questionnaire v{report.questionnaire_version}</div><div className="mt-2 space-y-2 text-sm leading-6">{reportSummary(report).map((line, index) => <p key={index} className="whitespace-pre-wrap">{line}</p>)}</div><details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">Raw source evidence</summary><pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-2">{JSON.stringify({ subjects: report.subjects, context: report.context, questionnaire: report.questionnaire_snapshot, response: report.response_payload, provenance: report.provenance }, null, 2)}</pre></details></article> })}</div>}
      </section>
    </main>
  )
}
