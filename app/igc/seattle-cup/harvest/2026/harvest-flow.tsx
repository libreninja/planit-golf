'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { completeHarvestAction, submitGuidedScoutingReportAction } from './actions'
import type { ContributorRole, HarvestMatchContext, PlayerExternalRef, RelationshipContext, ReportKind } from '@/lib/seattle-cup/harvest/domain'

interface MatchOption { matchNo: number; round: number; format: string; course: string; label: string }
const ratings = [['strength', 'Strength'], ['solid', 'Solid'], ['mixed', 'Mixed'], ['struggled', 'Struggled'], ['didnt_see_enough', "Didn't see enough"]] as const
const roles: Array<[ContributorRole, string]> = [['caddie', 'Caddie'], ['captain', 'Captain'], ['watcher_supporter', 'Watched / supported team'], ['other_firsthand', 'Other firsthand observer']]
const relationships: Array<[RelationshipContext, string]> = [['caddied', 'Caddied'], ['watched_match', 'Watched match'], ['watched_player', 'Watched player'], ['prior_golf_experience', 'Prior golf experience'], ['captain_observation', 'Captain observation'], ['played_against', 'Played against'], ['played_with', 'Played with'], ['other_firsthand', 'Other firsthand'], ['relayed', 'Relayed to me']]

function Done({ submitted }: { submitted: number }) {
  return <div className="rounded-3xl border border-primary/20 bg-white/90 p-8 text-center shadow-sm"><div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check className="h-6 w-6" /></div><h2 className="text-2xl">Thank you — that knowledge is saved.</h2><p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">{submitted > 0 ? `You added ${submitted} private ${submitted === 1 ? 'report' : 'reports'} for future Interbay teams.` : 'You completed the harvest. You can come back if something else occurs to you.'}</p></div>
}

function MatchFacts({ match }: { match: HarvestMatchContext }) {
  return <div className="grid gap-3 rounded-2xl border border-border bg-muted/35 p-4 text-sm sm:grid-cols-2"><div><span className="text-muted-foreground">Round / format</span><div className="font-medium">Round {match.round} · {match.format}</div></div><div><span className="text-muted-foreground">Course</span><div className="font-medium">{match.course}</div></div><div><span className="text-muted-foreground">Partner</span><div className="font-medium">{match.partners.map((p) => p.displayName).join(' & ') || 'Singles'}</div></div><div><span className="text-muted-foreground">Opponents</span><div className="font-medium">{match.opponents.map((p) => p.displayName).join(' & ')}</div></div><div className="sm:col-span-2"><span className="text-muted-foreground">Result</span><div className="font-medium">{match.result}</div></div></div>
}

function Rating({ name }: { name: string }) {
  return <select name={name} defaultValue="" className="w-full rounded-xl border border-input bg-white px-3 py-2 text-sm"><option value="">Choose only if you saw enough</option>{ratings.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
}

function Checks({ name, values }: { name: string; values: Array<[string, string]> }) {
  return <div className="mt-3 flex flex-wrap gap-2">{values.map(([value, label]) => <label key={value} className="flex items-center gap-2 rounded-full border border-border bg-white px-3 py-2 text-xs"><input type="checkbox" name={name} value={value} />{label}</label>)}</div>
}

function GuidedFields({ reportKind }: { reportKind: ReportKind }) {
  if (reportKind === 'course_observation') return <section className="rounded-2xl border border-border p-4"><h3 className="font-semibold">Course / hole learning</h3><textarea name="courseNote" required rows={5} placeholder="What should we remember?" className="mt-3 w-full rounded-xl border border-input px-3 py-2" /><input name="holeNumbers" placeholder="Hole numbers, e.g. 4, 12, 18" className="mt-3 w-full rounded-xl border border-input px-3 py-2 text-sm" /></section>
  if (reportKind === 'general_observation') return <section className="rounded-2xl border border-border p-4"><h3 className="font-semibold">What did you see? What should we know?</h3><textarea name="generalNote" required rows={6} className="mt-3 w-full rounded-xl border border-input px-3 py-2" /><label className="mt-4 block text-sm font-medium">Optional teammate advice<textarea name="finalAdvice" rows={3} className="mt-1 w-full rounded-xl border border-input px-3 py-2" /></label></section>
  return <div className="space-y-4">
    <section className="rounded-2xl border border-border p-4"><h3 className="font-semibold">Off the tee</h3><div className="mt-3"><Rating name="offTheTeeOverall" /></div><Checks name="offTeeCharacteristics" values={[["missed_left", 'Missed mostly left'], ['missed_right', 'Missed mostly right'], ['both_ways', 'Both ways'], ['distance_stood_out', 'Distance stood out'], ['accuracy_stood_out', 'Accuracy stood out']]} /><textarea name="offTheTeeNote" rows={2} placeholder="Optional note" className="mt-3 w-full rounded-xl border border-input px-3 py-2 text-sm" /></section>
    <section className="grid gap-4 sm:grid-cols-2"><div className="rounded-2xl border border-border p-4"><h3 className="font-semibold">Approach / irons</h3><div className="mt-3"><Rating name="approachIronsOverall" /></div><textarea name="approachIronsNote" rows={2} placeholder="Optional note" className="mt-3 w-full rounded-xl border border-input px-3 py-2 text-sm" /></div><div className="rounded-2xl border border-border p-4"><h3 className="font-semibold">Short game</h3><div className="mt-3"><Rating name="shortGameOverall" /></div><textarea name="shortGameNote" rows={2} placeholder="Optional note" className="mt-3 w-full rounded-xl border border-input px-3 py-2 text-sm" /></div></section>
    <section className="rounded-2xl border border-border p-4"><h3 className="font-semibold">Putting</h3><div className="mt-3"><Rating name="puttingOverall" /></div><Checks name="puttingSpecifics" values={[["exceptional", 'Exceptional / made everything'], ['strong_inside_10', 'Strong inside ~10 feet'], ['lag_putting_stood_out', 'Lag putting stood out'], ['short_putt_struggles', 'Short-putt struggles']]} /><textarea name="puttingNote" rows={2} placeholder="Optional note" className="mt-3 w-full rounded-xl border border-input px-3 py-2 text-sm" /></section>
    <section className="rounded-2xl border border-border p-4"><h3 className="font-semibold">On-course temperament</h3><p className="mt-1 text-xs text-muted-foreground">Private Interbay golf shorthand based on what you observed.</p><Checks name="temperamentLabels" values={[["ice_cold", 'Ice cold'], ['steady', 'Steady'], ['rides_momentum', 'Rides momentum'], ['hot_head', 'Hot head'], ['club_thrower', 'Club thrower'], ['checks_out', 'Checks out'], ['talker', 'Talker'], ['quiet_locked_in', 'Quiet / locked in'], ['didnt_see_enough', "Didn't see enough"]]} /><textarea name="temperamentNote" rows={2} placeholder="What did you see? Especially useful for stronger labels." className="mt-3 w-full rounded-xl border border-input px-3 py-2 text-sm" /></section>
    <section className="rounded-2xl border border-border p-4"><label className="font-semibold">What would you tell an Interbay teammate playing this person next year?<textarea name="finalAdvice" rows={4} className="mt-3 w-full rounded-xl border border-input px-3 py-2 font-normal" /></label><label className="mt-4 block text-sm font-medium">Optional course / hole lesson<textarea name="courseNote" rows={3} className="mt-1 w-full rounded-xl border border-input px-3 py-2" /></label><input name="holeNumbers" placeholder="Hole numbers, e.g. 4, 12, 18" className="mt-3 w-full rounded-xl border border-input px-3 py-2 text-sm" /></section>
  </div>
}

function GuidedHarvest({ personalizedMatches, players, matches, courses, initialReportCount, playerFlow }: { personalizedMatches: HarvestMatchContext[]; players: PlayerExternalRef[]; matches: MatchOption[]; courses: string[]; initialReportCount: number; playerFlow: boolean }) {
  const formRef = useRef<HTMLFormElement>(null)
  const [matchNo, setMatchNo] = useState(playerFlow ? String(personalizedMatches[0]?.matchNo ?? '') : '')
  const [reportKind, setReportKind] = useState<ReportKind>('player_assessment')
  const [saved, setSaved] = useState(0)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const selectedPlayerMatch = useMemo(() => personalizedMatches.find((match) => String(match.matchNo) === matchNo), [matchNo, personalizedMatches])
  const selectedOption = matches.find((match) => String(match.matchNo) === matchNo)
  const subjects = playerFlow ? selectedPlayerMatch?.opponents ?? [] : players

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(null)
    const data = new FormData(event.currentTarget)
    startTransition(async () => {
      try {
        await submitGuidedScoutingReportAction(data)
        setSaved((value) => value + 1)
        formRef.current?.querySelectorAll('textarea').forEach((field) => { field.value = '' })
        formRef.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((field) => { field.checked = false })
        formRef.current?.querySelectorAll<HTMLSelectElement>('select[name$="Overall"]').forEach((field) => { field.value = '' })
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save this report.') }
    })
  }
  const complete = () => startTransition(async () => { const data = new FormData(); data.set('reportCount', String(initialReportCount + saved)); await completeHarvestAction(data); setDone(true) })
  if (done) return <Done submitted={initialReportCount + saved} />

  return <div className="rounded-3xl border border-white/70 bg-white/90 p-5 shadow-xl shadow-primary/10 sm:p-8">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl">Guided scouting report</h2><p className="mt-1 text-sm text-muted-foreground">One saved report keeps this assessment together. Skip anything you did not see.</p></div>{saved > 0 ? <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">{saved} saved this visit</span> : null}</div>
    <form ref={formRef} onSubmit={submit} className="space-y-5">
      {playerFlow ? <><input type="hidden" name="contributorRole" value="player" /><input type="hidden" name="relationshipContext" value="played_against" /></> : null}
      {!playerFlow ? <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Your role<select name="contributorRole" defaultValue="watcher_supporter" className="mt-1 w-full rounded-xl border border-input bg-white px-3 py-2">{roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-sm font-medium">How you know this<select name="relationshipContext" defaultValue="watched_match" className="mt-1 w-full rounded-xl border border-input bg-white px-3 py-2">{relationships.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div> : null}
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Report type<select name="reportKind" value={reportKind} onChange={(event) => setReportKind(event.target.value as ReportKind)} className="mt-1 w-full rounded-xl border border-input bg-white px-3 py-2"><option value="player_assessment">Player assessment</option><option value="course_observation">Course / hole observation</option><option value="general_observation">General or multi-player observation</option></select></label><label className="text-sm font-medium">Match {playerFlow ? '' : '(optional)'}<select name="matchNo" value={matchNo} required={playerFlow} onChange={(event) => setMatchNo(event.target.value)} className="mt-1 w-full rounded-xl border border-input bg-white px-3 py-2"><option value="">Not sure / general</option>{(playerFlow ? personalizedMatches.map((match) => ({ ...match, label: `Match ${match.matchNo} · R${match.round} ${match.format} · ${match.course}` })) : matches).map((match) => <option key={match.matchNo} value={match.matchNo}>{match.label}</option>)}</select></label></div>
      {selectedPlayerMatch ? <MatchFacts match={selectedPlayerMatch} /> : selectedOption ? <p className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">Round {selectedOption.round} · {selectedOption.format} · {selectedOption.course}</p> : null}
      {reportKind === 'player_assessment' ? <label className="block text-sm font-medium">Player being evaluated<select name="subjectCardIds" required className="mt-1 w-full rounded-xl border border-input bg-white px-3 py-2"><option value="">Choose a player</option>{subjects.map((player) => <option key={player.value} value={player.value}>{player.displayName} · {player.teamKey ?? 'team unknown'}</option>)}</select></label> : null}
      {reportKind === 'general_observation' ? <div className="grid gap-4 sm:grid-cols-2">{[1, 2].map((number) => <label key={number} className="text-sm font-medium">{number === 1 ? 'Player / subject (optional)' : 'Second player / pair (optional)'}<select name="subjectCardIds" className="mt-1 w-full rounded-xl border border-input bg-white px-3 py-2"><option value="">None</option>{players.map((player) => <option key={player.value} value={player.value}>{player.displayName}</option>)}</select></label>)}</div> : null}
      {!selectedOption && !selectedPlayerMatch ? <label className="block text-sm font-medium">Course (optional)<select name="course" defaultValue="" className="mt-1 w-full rounded-xl border border-input bg-white px-3 py-2"><option value="">Not sure</option>{courses.map((course) => <option key={course} value={course}>{course}</option>)}</select></label> : null}
      <GuidedFields reportKind={reportKind} />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3"><Button type="button" variant="ghost" disabled={pending} onClick={complete}>Skip / finish harvest</Button><Button type="submit" disabled={pending}>{pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save this report</Button></div>
    </form>
  </div>
}

export function PersonalizedHarvestFlow({ matches, players, matchOptions, courses, initialReportCount }: { matches: HarvestMatchContext[]; players: PlayerExternalRef[]; matchOptions: MatchOption[]; courses: string[]; initialReportCount: number }) {
  return <GuidedHarvest personalizedMatches={matches} players={players} matches={matchOptions} courses={courses} initialReportCount={initialReportCount} playerFlow />
}
export function ObserverHarvestFlow({ players, matches, courses, initialReportCount }: { players: PlayerExternalRef[]; matches: MatchOption[]; courses: string[]; initialReportCount: number }) {
  return <GuidedHarvest personalizedMatches={[]} players={players} matches={matches} courses={courses} initialReportCount={initialReportCount} playerFlow={false} />
}
