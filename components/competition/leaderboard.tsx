"use client";

import { useState } from "react";
import type { Leaderboard } from "@/lib/competition/types";
import { ScorecardRow } from "./scorecard";
import { shouldShowPurse } from "./leaderboard-purse";
import { pickLeaderboardCols } from "./leaderboard-cols";
import { cn } from "@/lib/utils/cn";
import { playerDetailHrefForMemberCard } from "@/lib/players/links";

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
  playerReturnTo,
}: {
  leaderboard: Leaderboard;
  showFlight?: boolean;
  colorizeFlights?: boolean;
  projectedFlights?: boolean;
  golferIdsByMemberCard?: Record<string, string>;
  playerReturnTo?: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
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
          const playerHref = playerDetailHrefForMemberCard({
            memberCardId: card?.memberCardId ?? null,
            golferIdsByMemberCard,
            week: leaderboard.occurrenceId,
            returnTo: playerReturnTo,
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
              playerHref={playerHref}
            />
          );
        })}
      </div>
    </div>
  );
}
