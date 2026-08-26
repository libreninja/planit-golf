'use client'

import * as React from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

// Opposition-intelligence cheat sheet for the 2026 Seattle Cup picks call.
// All data is ALREADY-DERIVED in planit-ai (src/cup/publish.ts) and committed
// as data/seattle-cup-intel.json. This component only PRESENTS it — no
// historical calculation runs here.
//
// TWO LOOKUPS, intentionally overlapping:
//   1. Historical Chapman pairings — pair-centric: "Have these two played
//      Chapman together, and what happened?" (both players on the 2026 roster)
//   2. Current roster — player lookup — player-centric: "What do we know about
//      this golfer?" Contains the ENTIRE current roster (all 25 per team),
//      including players already in the pair section, players with no Chapman
//      history, and the head pro. Chapman/Singles history is an ATTRIBUTE of a
//      player here, not a criterion for appearing. A golfer appearing in both
//      sections is expected — do not deduplicate.
//
// SEMANTICS: every entry below is HISTORICAL — prior combinations/appearances
// where the golfers happen to be on the 2026 roster. Nobody has picked 2026
// pairings. This is a lookup/memory aid during the live picks call, NOT a
// predicted/recommended lineup. No inferred labels. Roster order is the
// roster's own (handicap/index), never win %.
//
// Historical per-match team handicaps are derived in planit-ai from the GG
// fixture card (Σgross − Σnet on a complete 18 only). Where the card is
// incomplete the value is "—" — never invented, never substituted from the
// current roster. Current roster HCs come from the locked 2026 roster.

export type Result = 'W' | 'L' | 'T'

export interface WeekendEntry {
  round: 'R1' | 'R2'
  format: string
  result: Result
  margin: string
  partner: string | null
  opponent: string
  gross: number | null
  holesPlayed: number | null
}

export interface ChapmanMatch {
  year: number
  course: string
  opponents: string
  ourTeamHdcp: number | null
  oppTeamHdcp: number | null
  strokes: string
  result: Result
  margin: string
}

export interface ChapmanPair {
  displayA: string
  displayB: string
  hdcpA: number | null
  hdcpB: number | null
  chapmanTeamHdcp: number | null
  apps: number
  w: number
  l: number
  t: number
  years: number[]
  lastYear: number | null
  bothPlayed2026: boolean
  form2026Note: string
  weekendA: WeekendEntry[]
  weekendB: WeekendEntry[]
  matches: ChapmanMatch[]
}

export interface PartnerTally {
  displayName: string
  count: number
  years: number[]
}

export interface ChapmanIndividualMatch {
  year: number
  course: string
  partner: string | null
  opponents: string
  ourTeamHdcp: number | null
  oppTeamHdcp: number | null
  strokes: string
  result: Result
  margin: string
}

export interface SinglesMatch {
  year: number
  course: string
  opponent: string
  ourHdcp: number | null
  oppHdcp: number | null
  strokes: string
  result: Result
  margin: string
}

export interface ChapmanHistory {
  apps: number
  w: number
  l: number
  t: number
  years: number[]
  lastYear: number | null
  partners: PartnerTally[]
  matches: ChapmanIndividualMatch[]
}

export interface SinglesHistory {
  apps: number
  w: number
  l: number
  t: number
  years: number[]
  lastYear: number | null
  lastOpponent: string | null
  matches: SinglesMatch[]
}

// One rostered golfer. chapman/singles are null where there is no history;
// weekend is empty where they did not tee off in R1/R2. These are attributes,
// not inclusion criteria — every rostered golfer appears here.
export interface PlayerLookupEntry {
  displayName: string
  handicapIndex: number | null
  westSeattleHdcp: number | null
  interbayHdcp: number | null
  jacksonParkHdcp: number | null
  billWrightHdcp: number | null
  chapL: number | null
  chapH: number | null
  isPro: boolean
  chapman: ChapmanHistory | null
  singles: SinglesHistory | null
  weekend: WeekendEntry[]
}

export interface TeamIntel {
  key: string
  label: string
  chapmanPairs: ChapmanPair[]
  playerLookup: PlayerLookupEntry[]
}

export interface IntelJson {
  generatedAt: string
  source: string
  years: number[]
  teams: TeamIntel[]
}

// --- presentational helpers ------------------------------------------------

const hdcp = (n: number | null): string =>
  n == null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(1)

const wlt = (w: number, l: number, t: number): string => `${w}-${l}-${t}`

// Compress consecutive years into ranges: [2021,2022,2023,2025] → "2021–2023, 2025"
function fmtYears(years: number[]): string {
  if (!years.length) return '—'
  const ys = [...years].sort((a, b) => a - b)
  const out: string[] = []
  let start = ys[0]
  let prev = ys[0]
  for (let i = 1; i <= ys.length; i++) {
    if (i < ys.length && ys[i] === prev + 1) {
      prev = ys[i]
    } else {
      out.push(start === prev ? `${start}` : `${start}–${prev}`)
      if (i < ys.length) {
        start = ys[i]
        prev = ys[i]
      }
    }
  }
  return out.join(', ')
}

// One weekend round line: "R1 Fourball: L with Stover" / "R2: —" / gross only
// when the card is a complete 18 (never a partial as a finished round).
function roundLine(round: 'R1' | 'R2', entries: WeekendEntry[]): string {
  const e = entries.find((x) => x.round === round)
  if (!e) return `${round}: —`
  let s = `${round} ${e.format}: ${e.result}`
  if (e.result !== 'T' && e.margin && e.margin !== e.result) s += ` ${e.margin}`
  if (e.partner) s += ` with ${e.partner}`
  if (e.holesPlayed === 18 && e.gross != null) s += ` · gross ${e.gross}`
  else if (e.holesPlayed != null && e.holesPlayed < 18) s += ` (thru ${e.holesPlayed})`
  return s
}

// Result cell: "W 3 & 1" / "L 1 up" / "T" (no redundant margin on ties).
function resultCell(r: Result, margin: string): string {
  if (r === 'T') return 'T'
  return margin && margin !== r ? `${r} ${margin}` : r
}

const resultColor = (r: Result): string =>
  r === 'W' ? 'text-emerald-700 dark:text-emerald-400' : r === 'L' ? 'text-rose-700 dark:text-rose-400' : 'text-muted-foreground'

// A player's own-team course handicap + short label (Chapman view). Singles
// view always uses the Interbay course HC (R4 Singles is hosted at Interbay).
const TEAM_LABEL_BY_KEY: Record<string, string> = {
  'west-seattle': 'West Seattle',
  'jackson-park': 'Jackson Park',
  'bill-wright': 'Bill Wright',
}
const teamLabel = (k: string): string => TEAM_LABEL_BY_KEY[k] ?? k
function teamHcOf(p: PlayerLookupEntry, teamKey: string): number | null {
  if (teamKey === 'west-seattle') return p.westSeattleHdcp
  if (teamKey === 'jackson-park') return p.jacksonParkHdcp
  if (teamKey === 'bill-wright') return p.billWrightHdcp
  return null
}
function teamHcLabel(teamKey: string): string {
  if (teamKey === 'west-seattle') return 'WS HC'
  if (teamKey === 'jackson-park') return 'JP HC'
  if (teamKey === 'bill-wright') return 'BW HC'
  return 'HC'
}

// --- shared table chrome ---------------------------------------------------

function MatchTable({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            {head.map((h, i) => (
              <th key={i} className={`whitespace-nowrap py-1 pr-3 font-medium ${h === 'Their HC' || h === 'Opp HC' ? 'text-right' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function WeekendBlock({ name, entries }: { name: string; entries: WeekendEntry[] }) {
  return (
    <div className="text-xs">
      <div className="font-medium text-foreground">{name}</div>
      <div className="pl-2 text-muted-foreground">{roundLine('R1', entries)}</div>
      <div className="pl-2 text-muted-foreground">{roundLine('R2', entries)}</div>
    </div>
  )
}

// Dense clickable row header used for all expandable lists.
function RowSummary({ children }: { children: React.ReactNode }) {
  return (
    <summary className="cursor-pointer list-none rounded-md border border-border bg-white/80 px-3 py-1.5 text-sm transition-colors hover:bg-accent/40 [&::-webkit-details-marker]:hidden">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">{children}</div>
    </summary>
  )
}

// --- Chapman pair view (top section) ---------------------------------------

function PairRow({ pair }: { pair: ChapmanPair }) {
  return (
    <details>
      <RowSummary>
        <span className="font-medium text-foreground">{pair.displayA} / {pair.displayB}</span>
        <span className="text-xs text-muted-foreground">{pair.apps} app{pair.apps === 1 ? '' : 's'}</span>
        <span className="text-xs text-muted-foreground">{fmtYears(pair.years)}</span>
        <span className="text-xs text-muted-foreground">W-L-T {wlt(pair.w, pair.l, pair.t)}</span>
        <span className="text-xs text-muted-foreground">HC {hdcp(pair.chapmanTeamHdcp)}</span>
      </RowSummary>
      <div className="space-y-2 px-1 pb-2 pt-1.5">
        <p className="text-xs text-muted-foreground">
          Current roster Chapman team HC {hdcp(pair.chapmanTeamHdcp)} ({hdcp(pair.hdcpA)}/{hdcp(pair.hdcpB)}). Per-match HCs below are historical.
        </p>
        <MatchTable head={['Year', 'Course', 'Opponents', 'Their HC', 'Opp HC', 'Strokes', 'Result']}>
          {pair.matches.map((m, i) => (
            <tr key={i} className="border-b border-border/40">
              <td className="whitespace-nowrap py-1 pr-3 tabular-nums">{m.year}</td>
              <td className="whitespace-nowrap py-1 pr-3">{m.course}</td>
              <td className="py-1 pr-3">{m.opponents}</td>
              <td className="py-1 pr-3 text-right tabular-nums">{hdcp(m.ourTeamHdcp)}</td>
              <td className="py-1 pr-3 text-right tabular-nums">{hdcp(m.oppTeamHdcp)}</td>
              <td className="whitespace-nowrap py-1 pr-3">{m.strokes}</td>
              <td className="whitespace-nowrap py-1 pr-3"><span className={resultColor(m.result)}>{resultCell(m.result, m.margin)}</span></td>
            </tr>
          ))}
        </MatchTable>
        <div>
          <h4 className="mb-1 text-xs font-semibold text-muted-foreground">2026 weekend</h4>
          <div className="space-y-1.5">
            <WeekendBlock name={pair.displayA} entries={pair.weekendA} />
            <WeekendBlock name={pair.displayB} entries={pair.weekendB} />
          </div>
        </div>
      </div>
    </details>
  )
}

// --- Player lookup (bottom section) ----------------------------------------

function ChapmanHistoryDetail({ h }: { h: ChapmanHistory }) {
  return (
    <>
      {h.partners.length ? (
        <p className="text-xs text-muted-foreground">
          Prior partners: {h.partners.map((pt) => `${pt.displayName} ×${pt.count}`).join(', ')}
        </p>
      ) : null}
      <MatchTable head={['Year', 'Course', 'With', 'Opponents', 'Their HC', 'Opp HC', 'Strokes', 'Result']}>
        {h.matches.map((m, i) => (
          <tr key={i} className="border-b border-border/40">
            <td className="whitespace-nowrap py-1 pr-3 tabular-nums">{m.year}</td>
            <td className="whitespace-nowrap py-1 pr-3">{m.course}</td>
            <td className="whitespace-nowrap py-1 pr-3">{m.partner ?? '—'}</td>
            <td className="py-1 pr-3">{m.opponents}</td>
            <td className="py-1 pr-3 text-right tabular-nums">{hdcp(m.ourTeamHdcp)}</td>
            <td className="py-1 pr-3 text-right tabular-nums">{hdcp(m.oppTeamHdcp)}</td>
            <td className="whitespace-nowrap py-1 pr-3">{m.strokes}</td>
            <td className="whitespace-nowrap py-1 pr-3"><span className={resultColor(m.result)}>{resultCell(m.result, m.margin)}</span></td>
          </tr>
        ))}
      </MatchTable>
    </>
  )
}

function SinglesHistoryDetail({ h }: { h: SinglesHistory }) {
  return (
    <MatchTable head={['Year', 'Course', 'Opponent', 'Their HC', 'Opp HC', 'Strokes', 'Result']}>
      {h.matches.map((m, i) => (
        <tr key={i} className="border-b border-border/40">
          <td className="whitespace-nowrap py-1 pr-3 tabular-nums">{m.year}</td>
          <td className="whitespace-nowrap py-1 pr-3">{m.course}</td>
          <td className="py-1 pr-3">{m.opponent}</td>
          <td className="py-1 pr-3 text-right tabular-nums">{hdcp(m.ourHdcp)}</td>
          <td className="py-1 pr-3 text-right tabular-nums">{hdcp(m.oppHdcp)}</td>
          <td className="whitespace-nowrap py-1 pr-3">{m.strokes}</td>
          <td className="whitespace-nowrap py-1 pr-3"><span className={resultColor(m.result)}>{resultCell(m.result, m.margin)}</span></td>
        </tr>
      ))}
    </MatchTable>
  )
}

function PlayerRow({
  p,
  teamKey,
  view,
}: {
  p: PlayerLookupEntry
  teamKey: string
  view: 'chapman' | 'singles'
}) {
  const isChap = view === 'chapman'
  const hc = isChap ? teamHcOf(p, teamKey) : p.interbayHdcp
  const hcLabel = isChap ? teamHcLabel(teamKey) : 'Interbay HC'
  const chapHist = p.chapman
  const singlesHist = p.singles
  const hist = isChap ? chapHist : singlesHist
  return (
    <details>
      <RowSummary>
        <span className="font-medium text-foreground">{p.displayName}</span>
        {p.isPro && <span className="text-xs text-muted-foreground">· head pro</span>}
        <span className="text-xs text-muted-foreground">idx {hdcp(p.handicapIndex)}</span>
        <span className="text-xs text-muted-foreground">{hcLabel} {hdcp(hc)}</span>
        {isChap && <span className="text-xs text-muted-foreground">Chap L/H {hdcp(p.chapL)}/{hdcp(p.chapH)}</span>}
        {hist ? (
          <>
            <span className="text-xs text-muted-foreground">{hist.apps} app{hist.apps === 1 ? '' : 's'}</span>
            <span className="text-xs text-muted-foreground">W-L-T {wlt(hist.w, hist.l, hist.t)}</span>
            <span className="text-xs text-muted-foreground">{fmtYears(hist.years)}</span>
            {!isChap && singlesHist?.lastOpponent && <span className="text-xs text-muted-foreground">last vs {singlesHist.lastOpponent}</span>}
          </>
        ) : (
          <span className="text-xs text-muted-foreground">no prior {isChap ? 'Chapman' : 'Singles'} appearances</span>
        )}
      </RowSummary>
      <div className="space-y-2 px-1 pb-2 pt-1.5">
        {/* Current */}
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Current:</span> idx {hdcp(p.handicapIndex)} · {hcLabel} {hdcp(hc)}
          {isChap && <> · Chap L/H {hdcp(p.chapL)}/{hdcp(p.chapH)}</>}
          <> · {teamLabel(teamKey)}</>
          {p.isPro && ' · head pro'}
        </div>
        {/* History (Chapman or Singles depending on tab) */}
        {isChap && p.chapman ? (
          <ChapmanHistoryDetail h={p.chapman} />
        ) : !isChap && p.singles ? (
          <SinglesHistoryDetail h={p.singles} />
        ) : (
          <p className="text-xs text-muted-foreground">
            No prior Seattle Cup {isChap ? 'Chapman' : 'Singles'} appearances in 2021–2025 data.
          </p>
        )}
        {/* 2026 Cup — R1/R2 activity, or a plain non-appearance note */}
        {p.weekend.length ? (
          <div>
            <h4 className="mb-1 text-xs font-semibold text-muted-foreground">2026 weekend</h4>
            <div className="pl-2 text-xs text-muted-foreground">{roundLine('R1', p.weekend)}</div>
            <div className="pl-2 text-xs text-muted-foreground">{roundLine('R2', p.weekend)}</div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No R1/R2 appearance.</p>
        )}
      </div>
    </details>
  )
}

function RosterSection({
  team,
  view,
  searching,
  copy,
}: {
  team: TeamIntel
  view: 'chapman' | 'singles'
  searching: boolean
  copy: string
}) {
  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold text-foreground">Current roster — player lookup</h3>
      <p className="mb-2 text-xs text-muted-foreground">{copy}</p>
      {team.playerLookup.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {searching ? 'No matching roster players.' : 'No rostered players.'}
        </p>
      ) : (
        <div className="space-y-1.5">
          {team.playerLookup.map((p, i) => (
            <PlayerRow key={i} p={p} teamKey={team.key} view={view} />
          ))}
        </div>
      )}
    </section>
  )
}

function ChapmanTeam({ team, searching }: { team: TeamIntel; searching: boolean }) {
  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-1 text-sm font-semibold text-foreground">Historical Chapman pairings — 2026 roster</h3>
        <p className="mb-2 text-xs text-muted-foreground">
          Prior Chapman combinations where both players are on this year&rsquo;s roster. These are historical
          pairings, not 2026 selections.
        </p>
        {team.chapmanPairs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {searching
              ? 'No Chapman pairings match this search.'
              : 'No prior Chapman pairing where both players are on this year’s roster.'}
          </p>
        ) : (
          <div className="space-y-1.5">
            {team.chapmanPairs.map((p, i) => <PairRow key={i} pair={p} />)}
          </div>
        )}
      </section>

      <RosterSection
        team={team}
        view="chapman"
        searching={searching}
        copy="Search any player on this year’s roster for handicap, Chapman history, prior partners, and recent Cup activity."
      />
    </div>
  )
}

// --- Singles view ----------------------------------------------------------

function SinglesTeam({ team, searching }: { team: TeamIntel; searching: boolean }) {
  return (
    <RosterSection
      team={team}
      view="singles"
      searching={searching}
      copy="Search any player on this year’s roster for handicap, Singles history, and recent Cup activity. Historical participation, not the 2026 Singles lineup."
    />
  )
}

// --- top-level cheat sheet -------------------------------------------------

const TEAM_ORDER = ['west-seattle', 'jackson-park', 'bill-wright'] as const

export function IntelCheatSheet({ intel }: { intel: IntelJson }) {
  const [format, setFormat] = React.useState<'chapman' | 'singles'>('chapman')
  const [team, setTeam] = React.useState<string>('west-seattle')
  const [query, setQuery] = React.useState('')
  const q = query.trim().toLowerCase()
  const searching = q.length > 0

  const teamsInOrder = TEAM_ORDER
    .map((k) => intel.teams.find((t) => t.key === k))
    .filter((t): t is TeamIntel => !!t)

  const matches = (s: string) => !q || s.toLowerCase().includes(q)
  const pairMatches = (p: ChapmanPair) => matches(p.displayA) || matches(p.displayB)
  const playerMatches = (p: PlayerLookupEntry) => matches(p.displayName)

  return (
    <div className="space-y-5 py-2">
      <div>
        <h1 className="font-display text-2xl leading-none">Seattle Cup · Opposition Intel</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          2026 R3 Chapman @ West Seattle · R4 Singles @ Interbay · {intel.years.join(', ')} history · facts only ·
          historical pairings, not 2026 selections
        </p>
      </div>

      {/* Search filter (client-side over already-loaded roster + pairs) */}
      <div>
        <label className="mb-1 block text-xs text-muted-foreground" htmlFor="intel-search">
          Search player
        </label>
        <input
          id="intel-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search player…"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-xs"
        />
      </div>

      <Tabs value={format} onValueChange={(v) => setFormat(v as 'chapman' | 'singles')}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="chapman">Chapman</TabsTrigger>
          <TabsTrigger value="singles">Singles</TabsTrigger>
        </TabsList>

        <TabsContent value="chapman" className="mt-4">
          {searching ? (
            <FlatResults
              teams={teamsInOrder}
              render={(t) => (
                <ChapmanTeam
                  searching
                  team={{
                    ...t,
                    chapmanPairs: t.chapmanPairs.filter(pairMatches),
                    playerLookup: t.playerLookup.filter(playerMatches),
                  }}
                />
              )}
              isEmpty={(t) => !t.chapmanPairs.some(pairMatches) && !t.playerLookup.some(playerMatches)}
            />
          ) : (
            <Tabs value={team} onValueChange={setTeam}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="west-seattle">West Seattle</TabsTrigger>
                <TabsTrigger value="jackson-park">Jackson Park</TabsTrigger>
                <TabsTrigger value="bill-wright">Bill Wright</TabsTrigger>
              </TabsList>
              {teamsInOrder.map((t) => (
                <TabsContent key={t.key} value={t.key} className="mt-4">
                  <ChapmanTeam team={t} searching={false} />
                </TabsContent>
              ))}
            </Tabs>
          )}
        </TabsContent>

        <TabsContent value="singles" className="mt-4">
          {searching ? (
            <FlatResults
              teams={teamsInOrder}
              render={(t) => (
                <SinglesTeam
                  searching
                  team={{ ...t, playerLookup: t.playerLookup.filter(playerMatches) }}
                />
              )}
              isEmpty={(t) => !t.playerLookup.some(playerMatches)}
            />
          ) : (
            <Tabs value={team} onValueChange={setTeam}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="west-seattle">West Seattle</TabsTrigger>
                <TabsTrigger value="jackson-park">Jackson Park</TabsTrigger>
                <TabsTrigger value="bill-wright">Bill Wright</TabsTrigger>
              </TabsList>
              {teamsInOrder.map((t) => (
                <TabsContent key={t.key} value={t.key} className="mt-4">
                  <SinglesTeam team={t} searching={false} />
                </TabsContent>
              ))}
            </Tabs>
          )}
        </TabsContent>
      </Tabs>

      <p className="pt-2 text-xs text-muted-foreground">
        Derived from Golf Genius fixtures {intel.years.join(', ')} and the locked 2026 roster. W-L-T from GG
        points. Historical per-match handicaps shown where the fixture card is a complete 18 (Σgross − Σnet);
        otherwise —. No recommendations, no predictions.
      </p>
    </div>
  )
}

// Flat (cross-team) results view used while a search filter is active. Teams
// with no matches are omitted entirely.
function FlatResults({
  teams,
  render,
  isEmpty,
}: {
  teams: TeamIntel[]
  render: (t: TeamIntel) => React.ReactNode
  isEmpty: (t: TeamIntel) => boolean
}) {
  const shown = teams.filter((t) => !isEmpty(t))
  if (shown.length === 0) {
    return <p className="text-sm text-muted-foreground">No matching players or pairs.</p>
  }
  return (
    <div className="space-y-6">
      {shown.map((t) => (
        <div key={t.key}>
          <h2 className="mb-2 text-sm font-semibold text-foreground">{t.label}</h2>
          {render(t)}
        </div>
      ))}
    </div>
  )
}