"use client";

import { useState } from "react";
import type { Leaderboard } from "@/lib/competition/types";
import { ScorecardRow } from "./scorecard";
import { cn } from "@/lib/utils/cn";

// showFlight renders a Flight column (POS / PLAYER / FLIGHT / …) — only for
// the finalized Men's "All" view. Driven by the workspace from grouping +
// capability state (grouping === 'all' && groupings.kind === 'multi'), never a
// route-name check. A specific flight makes the column redundant, live weeks
// are unflighted, and women's is single Overall. See FIX 2.
// colorizeFlights (P1-3) tints each row + its flight badge with the flight's
// color — true for any finalized Men's multi-flight week (All AND a specific
// flight). Live/women's stay neutral (the flag is false there).
export function Leaderboard({
  leaderboard,
  showFlight = false,
  colorizeFlights = false,
}: {
  leaderboard: Leaderboard;
  showFlight?: boolean;
  colorizeFlights?: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (leaderboard.entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No results available for this round.</p>;
  }
  const isGross = leaderboard.scoringMode === "gross";
  const smCols = showFlight
    ? "sm:grid-cols-[2.5rem_1fr_5rem_4rem_3rem_4rem_4rem_5rem]"
    : "sm:grid-cols-[2.5rem_1fr_4rem_3rem_4rem_4rem_5rem]";
  return (
    <div className="overflow-hidden rounded-md border border-border">
      {/* header (hidden on mobile — rows stack). The Flight header only appears
          on sm+ alongside the column; mobile keeps the original 7-col grid. */}
      <div
        className={cn(
          "hidden grid-cols-[2.5rem_1fr_4rem_3rem_4rem_4rem_5rem] gap-2 bg-muted/40 px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground sm:grid",
          smCols,
        )}
      >
        <span>Pos</span>
        <span>Player</span>
        {showFlight && <span className="text-right">Flight</span>}
        <span className="text-right">{isGross ? "Gross par" : "Net par"}</span>
        <span className="text-right">Thru</span>
        <span className="text-right">{isGross ? "Gross" : "Net"}</span>
        <span className="text-right">Points</span>
        <span className="text-right">Purse</span>
      </div>
      <div className="divide-y divide-border">
        {leaderboard.entries.map((e) => {
          const card = leaderboard.scorecards.find((c) => c.key === e.key) ?? null;
          const key = `${leaderboard.scoringMode}|${e.key}`;
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
              colorizeFlights={colorizeFlights}
            />
          );
        })}
      </div>
    </div>
  );
}