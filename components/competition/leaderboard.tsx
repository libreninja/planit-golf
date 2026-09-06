"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Leaderboard } from "@/lib/competition/types";
import { ScorecardRow } from "./scorecard";
import { shouldShowPurse } from "./leaderboard-purse";
import { pickLeaderboardCols } from "./leaderboard-cols";
import { cn } from "@/lib/utils/cn";
import {
  resolveLeaderboardPlayerInteraction,
  type LeaderboardFollowState,
} from "@/lib/players/leaderboard-interaction";
import { buildLeaderboardForYou } from "@/lib/players/leaderboard-for-you";
import { displayPersonName } from "@/lib/players/person-name";
import { FOLLOW_STATE_EVENT, type FollowStateEventDetail } from "@/lib/players/follow-state-event";
import { playerDetailHref } from "@/lib/players/links";

function LeaderboardForYou({
  leaderboard,
  golferIdsByMemberCard,
  playerFollowState,
  playerReturnTo,
}: {
  leaderboard: Leaderboard
  golferIdsByMemberCard: Record<string, string>
  playerFollowState: LeaderboardFollowState
  playerReturnTo?: string
}) {
  const items = buildLeaderboardForYou({ leaderboard, golferIdsByMemberCard, followState: playerFollowState })
  if (items.length === 0) return null

  const scoringLabel = leaderboard.scoringMode === 'gross' ? 'Gross' : 'Net'
  return (
    <section className="rounded-md border border-primary/25 bg-primary/[0.035] px-3 py-2.5" aria-label="For you leaderboard summary">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">For you</h2>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{scoringLabel}</span>
      </div>
      <div className="grid max-h-36 grid-cols-2 gap-x-3 overflow-y-auto sm:grid-cols-4">
        {items.map((item) => {
          const name = item.isSelf ? 'You' : displayPersonName(item.sourceName)
          return (
            <Link
              key={item.golferId}
              href={playerDetailHref({
                golferId: item.golferId,
                week: leaderboard.occurrenceId,
                scoring: leaderboard.scoringMode === 'gross' ? 'gross' : 'net',
                returnTo: playerReturnTo,
              })}
              title={item.isSelf ? displayPersonName(item.sourceName) : name}
              className={cn(
                'min-w-0 border-t border-border/60 py-2 hover:text-primary [&:nth-child(-n+2)]:border-t-0 sm:[&:nth-child(-n+4)]:border-t-0',
                item.isSelf && 'font-semibold',
              )}
            >
              <p className="truncate text-sm font-semibold leading-tight">{name}</p>
              <p className="mt-0.5 truncate text-[11px] tabular-nums text-muted-foreground">
                {item.position} · {item.score} · {item.progress}
              </p>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

// showFlight renders a Flight column (POS / PLAYER / FLIGHT / …) for the Men's
// Overall view. A specific flight makes the column redundant; women's is single
// Overall. colorizeFlights keeps the existing row/badge colors in projected and
// official flight views.
export function Leaderboard({
  leaderboard,
  showFlight = false,
  colorizeFlights = false,
  projectedFlights = false,
  golferIdsByMemberCard = {},
  playerFollowState = { signedIn: false, followedGolferIds: [], selfGolferIds: [] },
  playerReturnTo,
  showForYou = false,
  forYouLeaderboard,
}: {
  leaderboard: Leaderboard;
  showFlight?: boolean;
  colorizeFlights?: boolean;
  projectedFlights?: boolean;
  golferIdsByMemberCard?: Record<string, string>;
  playerFollowState?: LeaderboardFollowState;
  playerReturnTo?: string;
  showForYou?: boolean;
  forYouLeaderboard?: Leaderboard | null;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [followedGolferIds, setFollowedGolferIds] = useState(playerFollowState.followedGolferIds);
  useEffect(() => {
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<FollowStateEventDetail>).detail;
      if (!detail?.golferId) return;
      setFollowedGolferIds((current) => detail.following
        ? [...new Set([...current, detail.golferId])]
        : current.filter((golferId) => golferId !== detail.golferId));
    };
    window.addEventListener(FOLLOW_STATE_EVENT, sync);
    return () => window.removeEventListener(FOLLOW_STATE_EVENT, sync);
  }, []);
  const effectiveFollowState = { ...playerFollowState, followedGolferIds };
  if (leaderboard.entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No results available for this round.</p>;
  }
  const isGross = leaderboard.scoringMode === "gross";
  // Purse column is data-driven: shown only when at least one entry carries a
  // purse. A no-money round (Club Championship Monday — points only) hides the
  // column instead of rendering an empty one; a money round (Tuesday) keeps it.
  // Season Points entries have no purse, so the column is hidden there too.
  const showPurse = shouldShowPurse(leaderboard.entries);
  // Grid columns adapt to which optional columns render. Flight is sm+ only
  // (mobile never shows it), so the base (mobile) template never includes it.
  // Literal class strings come from pickLeaderboardCols so Tailwind's JIT can
  // see each variant (dynamically built class names are silently dropped).
  const cols = pickLeaderboardCols(showFlight, showPurse);
  return (
    <div className="space-y-3">
      {showForYou && forYouLeaderboard ? (
        <LeaderboardForYou
          leaderboard={forYouLeaderboard}
          golferIdsByMemberCard={golferIdsByMemberCard}
          playerFollowState={effectiveFollowState}
          playerReturnTo={playerReturnTo}
        />
      ) : null}
      <div className="overflow-hidden rounded-md border border-border">
      {/* header (hidden on mobile — rows stack). The Flight header only appears
          on sm+ alongside the column; mobile keeps the original 7-col grid. */}
      <div
        className={cn(
          "hidden gap-2 bg-muted/40 px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground sm:grid",
          cols.base,
          cols.sm,
        )}
      >
        <span>Pos</span>
        <span>Player</span>
        {showFlight && <span className="text-right">{projectedFlights ? "Projected flight" : "Flight"}</span>}
        <span className="text-right">{isGross ? "Gross par" : "Net par"}</span>
        <span className="text-right">Thru</span>
        <span className="text-right">{isGross ? "Gross" : "Net"}</span>
        <span className="text-right">Points</span>
        {showPurse && <span className="text-right">Purse</span>}
      </div>
      <div className="divide-y divide-border">
        {leaderboard.entries.map((e) => {
          const card = leaderboard.scorecards.find((c) => c.key === e.key) ?? null;
          const key = `${leaderboard.scoringMode}|${e.key}`;
          const playerInteraction = resolveLeaderboardPlayerInteraction({
            memberCardId: card?.memberCardId ?? null,
            golferIdsByMemberCard,
            followState: effectiveFollowState,
            week: leaderboard.occurrenceId,
            returnTo: playerReturnTo,
            scoring: isGross ? 'gross' : 'net',
          });
          return (
            <ScorecardRow
              key={key}
              entry={e}
              card={card}
              scoringMode={leaderboard.scoringMode}
              live={leaderboard.resultStatus === "live"}
              isOpen={expanded === key}
              onToggle={() => setExpanded((c) => (c === key ? null : key))}
              showFlight={showFlight}
              showPurse={showPurse}
              colorizeFlights={colorizeFlights}
              flightLabel={e.flight && projectedFlights ? `Projected ${e.flight}` : e.flight}
              playerInteraction={playerInteraction}
            />
          );
        })}
      </div>
      </div>
    </div>
  );
}
