import { requireHarvestAccess } from '@/lib/seattle-cup/harvest/access'
import { loadSeattleCup2026Archive } from '@/lib/seattle-cup/harvest/archive-context'
import {
  allArchiveMatches,
  archivePlayerRefs,
} from '@/lib/seattle-cup/harvest/domain'
import { loadContributorHarvestSession } from '@/lib/seattle-cup/harvest/repository'
import { Button } from '@/components/ui/button'
import { confirmHarvestIdentityAction } from './actions'
import { ObserverHarvestFlow, PersonalizedHarvestFlow } from './harvest-flow'

export const dynamic = 'force-dynamic'

export default async function SeattleCupHarvestPage() {
  const { user } = await requireHarvestAccess()
  const session = await loadContributorHarvestSession(user)
  const archive = loadSeattleCup2026Archive()

  if (session.requiresIdentityConfirmation) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10 sm:py-16">
        <div className="rounded-3xl border border-white/70 bg-white/90 p-8 shadow-xl shadow-primary/10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Seattle Cup 2026 Intel Harvest</p>
          <h1 className="mt-3 text-3xl">Before we show any matches, is this you?</h1>
          <p className="mt-2 text-sm text-muted-foreground">We matched the invitation/account to an archive player, but a name or email match is not canonical identity. Confirm once before continuing.</p>
          <div className="mt-6 space-y-3">
            {session.confirmationCandidates.map((candidate) => (
              <form key={candidate.value} action={confirmHarvestIdentityAction} className="flex items-center justify-between gap-4 rounded-2xl border border-border p-4">
                <input type="hidden" name="ggMemberCardId" value={candidate.value} />
                <div><div className="font-semibold">{candidate.displayName}</div><div className="text-xs text-muted-foreground">2026 {candidate.teamKey ?? 'Seattle Cup'} player</div></div>
                <Button type="submit">This is me</Button>
              </form>
            ))}
          </div>
          <p className="mt-5 text-xs text-muted-foreground">Not you? Ask the captain who sent the invitation to correct the match. You will not be shown these appearances without confirmation.</p>
        </div>
      </main>
    )
  }

  const completed = session.participant.campaign_status === 'completed' || session.participant.campaign_status === 'skipped'
  const isPlayerFlow = session.matches.length > 0
  const matchOptions = allArchiveMatches(archive).map((match) => ({
    matchNo: match.matchNo,
    round: match.round,
    format: match.format,
    course: match.course,
    label: `Match ${match.matchNo} · R${match.round} ${match.format} · ${match.course}`,
  }))
  const courses = [...new Set(archive.content.schedule.map((round) => round.course))]

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <header className="mb-7">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Seattle Cup 2026 Intel Harvest</p>
        <h1 className="mt-2 text-3xl sm:text-4xl">{isPlayerFlow ? 'We already found your 2026 matches.' : "What did you see during this year's Cup?"}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          {isPlayerFlow
            ? "Interbay's win is still fresh. Add what you remember while it's fresh — partners, opponents, and match facts are already filled in."
            : 'Choose the match, player, pair, round, or course you remember. You do not need a playing appearance or an Interbay roster record to contribute.'}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">About five minutes · every question is optional · nothing here is public</p>
      </header>
      {completed ? (
        <div className="mb-5 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">You already completed this harvest. You can still add another pass if something else came back to you.</div>
      ) : null}
      {isPlayerFlow ? (
        <PersonalizedHarvestFlow matches={session.matches} players={archivePlayerRefs(archive)} matchOptions={matchOptions} courses={courses} initialReportCount={session.ownReports.length} />
      ) : (
        <ObserverHarvestFlow players={archivePlayerRefs(archive)} matches={matchOptions} courses={courses} initialReportCount={session.ownReports.length} />
      )}
      {session.ownReports.length > 0 ? (
        <section className="mt-8 rounded-2xl border border-border bg-white/70 p-5">
          <h2 className="text-lg">Your saved reports</h2>
          <div className="mt-3 space-y-3">
            {session.ownReports.map((report) => (
              <article key={report.id} className="rounded-xl bg-muted/45 p-3 text-sm">
                <div className="text-xs text-muted-foreground">{report.report_kind.replaceAll('_', ' ')} · {report.visibility === 'captain' ? 'captains only' : 'private team evidence'}</div>
                <div className="mt-1 font-medium">{report.subjects.map((subject) => subject.displayName).join(', ') || report.context.course || 'General observation'}</div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  )
}
