"use client";

import type {
  Scorecard as ScorecardT,
  ResultEntry,
  ScoringMode,
} from "@/lib/competition/types";

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

// ---- player row + expandable (shared) scorecard -----------------------------

export function ScorecardRow({
  entry,
  card,
  scoringMode,
  live,
  isOpen,
  onToggle,
  showFlight = false,
}: {
  entry: ResultEntry;
  card: ScorecardT | null;
  scoringMode: ScoringMode;
  live: boolean;
  isOpen: boolean;
  onToggle: () => void;
  showFlight?: boolean;
}) {
  const isGross = scoringMode === "gross";
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
          "grid w-full grid-cols-[2.5rem_1fr_4rem_3rem_4rem_4rem_5rem] items-center gap-2 px-3 py-2 text-left text-sm",
          showFlight
            ? "sm:grid-cols-[2.5rem_1fr_5rem_4rem_3rem_4rem_4rem_5rem]"
            : "sm:grid-cols-[2.5rem_1fr_4rem_3rem_4rem_4rem_5rem]",
          hasHoles ? "cursor-pointer hover:bg-muted/30" : "cursor-default",
        ].join(" ")}
      >
        <span className="font-medium tabular-nums text-muted-foreground">
          {entry.positionLabel ?? "—"}
        </span>
        <span className="truncate font-medium">{entry.name}</span>
        {showFlight && (
          <span className="hidden truncate text-right text-xs tabular-nums text-muted-foreground sm:block">
            {entry.flight ?? "—"}
          </span>
        )}
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

function Scorecard({ card }: { card: ScorecardT }) {
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
function toParNarration(card: ScorecardT): string {
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
