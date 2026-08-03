"use client";

import { useState } from "react";
import type { Leaderboard } from "@/lib/competition/types";
import { ScorecardRow } from "./scorecard";

export function Leaderboard({ leaderboard }: { leaderboard: Leaderboard }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (leaderboard.entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No results available for this round.</p>;
  }
  const isGross = leaderboard.scoringMode === "gross";
  return (
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
            />
          );
        })}
      </div>
    </div>
  );
}
