"use client";

import { useMemo, useCallback, useEffect, useState } from "react";
import type {
  WeeklyRoundResult,
  WeeklyFlight,
  WeeklyCompetition,
  WeeklyResultEntry,
  WeeklyScorecard,
} from "@/lib/igc/weekly-results";

// Live round config. Present only when the selected/default week is an
// in-progress round the page has already confirmed is live; the client then
// polls pollUrl for fresh results.
interface LiveConfig {
  weekNumber: number;
  pollUrl: string;
}

export interface EligibleWeek {
  weekNumber: number;
  label: string;
  date: string | null;
  isTeamEvent?: boolean;
}

interface Props {
  basePath: string;
  selectedWeek: number | undefined;
  eligibleWeeks: EligibleWeek[];
  initial: WeeklyRoundResult | null;
  live: LiveConfig | null;
}

const POLL_MS = 75_000; // 75s — fresh enough for a league leaderboard, cheap on GG

// ---- formatting helpers -----------------------------------------------------

function formatToPar(n: number | null): string {
  if (n === null) return "—";
  if (n === 0) return "E";
  return n > 0 ? `+${n}` : `${n}`;
}

function formatThru(holesCompleted: number, isLive: boolean): string {
  if (!isLive) return holesCompleted > 0 ? "F" : "—";
  return `thru ${holesCompleted}`;
}

function formatPoints(n: number | null): string {
  if (n === null) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

function toParClass(n: number | null): string {
  if (n === null || n === 0) return "text-muted-foreground";
  return n < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
}

// ---- component --------------------------------------------------------------

export function WeeklyResultsView({ basePath, selectedWeek, eligibleWeeks, initial, live }: Props) {
  const [round, setRound] = useState<WeeklyRoundResult | null>(initial);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(live ? new Date() : null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Expanded scorecard key, scoped per result row
  // (`${flight}|${competition}|${playerKey}`) so a player's card opens under
  // the Net OR Gross row the user clicked — never duplicated across both.
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!live) return;
    setRefreshing(true);
    try {
      const res = await fetch(live.pollUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`refresh failed (${res.status})`);
      const json = (await res.json()) as { results?: WeeklyRoundResult };
      if (json.results) {
        setRound(json.results);
        setLastRefreshed(new Date());
        setPollError(null);
      }
    } catch {
      setPollError("Live refresh failed — showing the most recent update.");
    } finally {
      setRefreshing(false);
    }
  }, [live]);

  // Poll at ~75s; pause while the tab is hidden (no fetches, no timer drift).
  useEffect(() => {
    if (!live) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id === null) id = setInterval(() => { void refresh(); }, POLL_MS);
    };
    const stop = () => {
      if (id !== null) { clearInterval(id); id = null; }
    };
    const onVis = () => { if (document.hidden) stop(); else start(); };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVis);
    return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
  }, [live, refresh]);

  const toggle = (key: string) => setExpanded((cur) => (cur === key ? null : key));

  return (
    <div className="space-y-4">
      {live && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-2.5 py-1 font-semibold text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            LIVE
          </span>
          {lastRefreshed && (
            <span className="text-muted-foreground">
              Updated {lastRefreshed.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </span>
          )}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh now"}
          </button>
          {pollError && <span className="text-amber-600 dark:text-amber-400">{pollError}</span>}
        </div>
      )}

      <WeekSelector basePath={basePath} selectedWeek={selectedWeek} eligibleWeeks={eligibleWeeks} />

      {round?.isTeamEvent ? (
        <TeamEventState round={round} />
      ) : round && round.hasResults ? (
        <div className="space-y-6">
          {round.flights.map((flight) => (
            <FlightSection
              key={flight.name}
              flight={flight}
              live={!!live}
              expanded={expanded}
              onToggle={toggle}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {round ? "No individual results available for this round yet." : "No results available for this round."}
        </p>
      )}
    </div>
  );
}

// ---- week selector (URL-driven links) ---------------------------------------

function WeekSelector({
  basePath,
  selectedWeek,
  eligibleWeeks,
}: {
  basePath: string;
  selectedWeek: number | undefined;
  eligibleWeeks: EligibleWeek[];
}) {
  if (eligibleWeeks.length === 0) {
    return <p className="text-sm text-muted-foreground">No completed rounds yet.</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {eligibleWeeks.map((w) => {
        const active = w.weekNumber === selectedWeek;
        return (
          <a
            key={w.weekNumber}
            href={`${basePath}?week=${w.weekNumber}`}
            aria-current={active ? "page" : undefined}
            className={[
              "rounded-md border px-2.5 py-1 text-xs transition-colors",
              active
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background text-muted-foreground hover:border-foreground/40 hover:text-foreground",
              w.isTeamEvent ? "italic" : "",
            ].join(" ")}
          >
            {w.isTeamEvent ? "🎾 " : ""}
            {w.label}
          </a>
        );
      })}
    </div>
  );
}

// ---- team / scramble honest state ------------------------------------------

function TeamEventState({ round }: { round: WeeklyRoundResult }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm">
      <p className="font-medium">Team event</p>
      <p className="mt-1 text-muted-foreground">
        {round.eventName} is a team/scramble format. Golf Genius tracks team
        results only, so individual scorecards aren&apos;t available for this
        round.
      </p>
    </div>
  );
}

// ---- flight section (Net + Gross competitions, shared scorecards) ----------

function FlightSection({
  flight,
  live,
  expanded,
  onToggle,
}: {
  flight: WeeklyFlight;
  live: boolean;
  expanded: string | null;
  onToggle: (key: string) => void;
}) {
  // One scorecard lookup map per flight. A player ranked in both Net and Gross
  // has ONE card here; both result rows open it (never duplicated).
  const cardsByKey = useMemo(() => {
    const m = new Map<string, WeeklyScorecard>();
    for (const c of flight.scorecards) m.set(c.key, c);
    return m;
  }, [flight.scorecards]);

  return (
    <section className="space-y-1.5">
      <h3 className="text-sm font-semibold text-muted-foreground">{flight.name}</h3>
      <div className="space-y-3">
        {flight.competitions.map((comp) => (
          <CompetitionTable
            key={`${flight.name}|${comp.competition}`}
            flightName={flight.name}
            competition={comp}
            cardsByKey={cardsByKey}
            live={live}
            expanded={expanded}
            onToggle={onToggle}
          />
        ))}
      </div>
    </section>
  );
}

// ---- competition table (Net or Gross) ---------------------------------------

function CompetitionTable({
  flightName,
  competition,
  cardsByKey,
  live,
  expanded,
  onToggle,
}: {
  flightName: string;
  competition: WeeklyCompetition;
  cardsByKey: Map<string, WeeklyScorecard>;
  live: boolean;
  expanded: string | null;
  onToggle: (key: string) => void;
}) {
  const isGross = competition.competition === "gross";
  // The headline to-par for this competition: net to-par (Net) / gross to-par
  // (Gross). The stroke-total column is correspondingly net total / gross
  // total — each competition shows its OWN to-par and its OWN total.
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className={`text-xs font-semibold uppercase tracking-wide ${isGross ? "text-amber-600 dark:text-amber-400" : "text-sky-600 dark:text-sky-400"}`}>
          {isGross ? "Gross" : "Net"}
        </span>
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        {/* header (hidden on mobile — rows stack) */}
        <div className="hidden grid-cols-[2.5rem_1fr_4rem_3rem_4rem_4rem_5rem] gap-2 bg-muted/40 px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground sm:grid">
          <span>Pos</span>
          <span>Player</span>
          <span className="text-right">{isGross ? "Gross par" : "Net par"}</span>
          <span className="text-right">Thru</span>
          <span className="text-right">{isGross ? "Gross" : "Net"}</span>
          <span className="text-right">Points</span>
          <span className="text-right">Purse</span>
        </div>
        <div className="divide-y divide-border">
          {competition.players.map((p) => {
            const card = cardsByKey.get(p.key) ?? null;
            const key = `${flightName}|${competition.competition}|${p.key}`;
            return (
              <PlayerRow
                key={key}
                entry={p}
                card={card}
                competition={competition.competition}
                live={live}
                isOpen={expanded === key}
                onToggle={() => onToggle(key)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---- player row + expandable (shared) scorecard -----------------------------

function PlayerRow({
  entry,
  card,
  competition,
  live,
  isOpen,
  onToggle,
}: {
  entry: WeeklyResultEntry;
  card: WeeklyScorecard | null;
  competition: "gross" | "net";
  live: boolean;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const isGross = competition === "gross";
  const hasHoles = !!card && card.holes.some((h) => h.gross !== null || h.net !== null);
  // Headline to-par + stroke total for THIS competition.
  const toPar = isGross ? card?.toParGross ?? null : card?.toParNet ?? null;
  const total = isGross ? card?.grossTotal ?? null : card?.netTotal ?? null;
  const holesCompleted = card?.holesCompleted ?? 0;
  const isPlayerLive = live && !!card?.isLive;

  return (
    <div>
      <button
        type="button"
        onClick={hasHoles ? onToggle : undefined}
        disabled={!hasHoles}
        aria-expanded={isOpen}
        className={[
          "grid w-full grid-cols-[2.5rem_1fr_4rem_3rem_4rem_4rem_5rem] items-center gap-2 px-3 py-2 text-left text-sm sm:grid-cols-[2.5rem_1fr_4rem_3rem_4rem_4rem_5rem]",
          hasHoles ? "cursor-pointer hover:bg-muted/30" : "cursor-default",
        ].join(" ")}
      >
        <span className="font-medium tabular-nums text-muted-foreground">
          {entry.positionLabel ?? "—"}
        </span>
        <span className="truncate font-medium">{entry.name}</span>
        <span className={`text-right font-semibold tabular-nums ${toParClass(toPar)}`}>
          {formatToPar(toPar)}
        </span>
        <span className="text-right tabular-nums text-muted-foreground">
          {formatThru(holesCompleted, isPlayerLive)}
        </span>
        <span className="text-right tabular-nums text-muted-foreground">
          {total ?? "—"}
        </span>
        <span className="text-right tabular-nums">{formatPoints(entry.points)}</span>
        <span className="text-right tabular-nums text-muted-foreground">{entry.purse ?? "—"}</span>
      </button>
      {isOpen && hasHoles && card && <Scorecard card={card} />}
    </div>
  );
}

function Scorecard({ card }: { card: WeeklyScorecard }) {
  return (
    <div className="border-t border-border bg-muted/20 px-3 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Net <span className="font-semibold text-foreground tabular-nums">{card.netTotal ?? "—"}</span> ({formatToPar(card.toParNet)})</span>
        <span>Gross <span className="font-semibold text-foreground tabular-nums">{card.grossTotal ?? "—"}</span> ({formatToPar(card.toParGross)})</span>
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1">
        {card.holes.map((h) => {
          const isPlayed = h.gross !== null || h.net !== null;
          return (
            <div
              key={h.hole}
              className={[
                "min-w-[3.25rem] shrink-0 rounded-md border px-1.5 py-1 text-center text-[11px] leading-tight",
                isPlayed ? "border-border bg-background" : "border-dashed border-border/60 bg-transparent text-muted-foreground/50",
              ].join(" ")}
            >
              <div className="text-muted-foreground">{h.hole}</div>
              <div className="tabular-nums text-muted-foreground/80">par {h.par ?? "—"}</div>
              <div className="tabular-nums font-semibold">{h.gross ?? "—"}</div>
              <div className={`tabular-nums ${toParClass(h.toPar)}`}>
                {h.net !== null ? (h.toPar === null ? h.net : h.toPar === 0 ? "E" : h.toPar > 0 ? `+${h.toPar}` : `${h.toPar}`) : "—"}
              </div>
            </div>
          );
        })}
      </div>
      {card.holes.length > 1 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {toParNarration(card)}
        </p>
      )}
    </div>
  );
}

// A short, human-readable summary of how the round unfolded (e.g. "Through 4:
// -2 · now +1 through 7"). Derived from the running to-par.
function toParNarration(card: WeeklyScorecard): string {
  const played = card.holes.filter((h) => h.cumulativeToPar !== null);
  if (played.length < 2) return "";
  const first = played[0];
  const last = played[played.length - 1];
  const fmt = (n: number) => (n === 0 ? "E" : n > 0 ? `+${n}` : `${n}`);
  const allPlayed = card.holes.filter((h) => h.gross !== null || h.net !== null).length;
  if (first.cumulativeToPar === last.cumulativeToPar && played.length === allPlayed) {
    return `Through ${first.hole}: ${fmt(first.cumulativeToPar!)} · finished ${fmt(last.cumulativeToPar!)} through ${last.hole}`;
  }
  return `Through ${first.hole}: ${fmt(first.cumulativeToPar!)} · now ${fmt(last.cumulativeToPar!)} through ${last.hole}`;
}