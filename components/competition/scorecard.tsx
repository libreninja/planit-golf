"use client";

import { cn } from "@/lib/utils/cn";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type {
  Scorecard as ScorecardT,
  ResultEntry,
  ScoringMode,
} from "@/lib/competition/types";
import { flightColor } from "./flight-color";
import { pickLeaderboardCols } from "./leaderboard-cols";
import { hasPurseAward } from "./leaderboard-purse";
import {
  buildMobileStats,
  formatToPar,
  formatThru,
  formatPoints,
  toParClass,
} from "./leaderboard-format";

// One labeled stat for the portrait mobile stat strip. The value sits
// prominently on top; the micro-label beneath gives it context (the desktop
// header is hidden at this width, so a bare 27 / F / 281.25 must not appear
// without a label). Value-then-label mirrors the agreed mobile hierarchy.
function MobileStat({
  label,
  value,
  valueClass,
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="text-center">
      <div className={cn("font-semibold tabular-nums leading-tight", valueClass)}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  )
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
  showPurse = false,
  colorizeFlights = false,
  flightLabel,
  playerHref,
}: {
  entry: ResultEntry;
  card: ScorecardT | null;
  scoringMode: ScoringMode;
  live: boolean;
  isOpen: boolean;
  onToggle: () => void;
  showFlight?: boolean;
  showPurse?: boolean;
  colorizeFlights?: boolean;
  flightLabel?: string | null;
  playerHref?: string | null;
}) {
  const isGross = scoringMode === "gross";
  const hasHoles = !!card && card.holes.some((h) => h.gross !== null || h.net !== null);
  // Headline to-par + stroke total for THIS competition.
  const toPar = isGross ? card?.toParGross ?? null : card?.toParNet ?? null;
  const total = isGross ? card?.grossTotal ?? null : card?.netTotal ?? null;
  const holesCompleted = card?.holesCompleted ?? 0;
  const isPlayerLive = live && !!card?.isLive;
  // P1-3: subtle per-flight tint + badge for finalized Men's multi-flight views.
  // null for non-numeric/unflighted rows → those rows stay neutral.
  const color = colorizeFlights ? flightColor(entry.flight) : null;
  // Literal class strings from pickLeaderboardCols so Tailwind sees each
  // variant (dynamically built class names are silently dropped by the JIT).
  const cols = pickLeaderboardCols(showFlight, showPurse);
  const showPlayerPurse = showPurse && hasPurseAward(entry.purse);

  return (
    <div>
      <div
        className={cn(
          "w-full px-3 py-2 text-left text-sm",
          color ? color.row : "",
        )}
      >
        {/* Portrait mobile layout (sm:hidden). Name is primary on its own
            line, with a compact labeled stat strip beneath it so every value
            has context without the desktop header (which is hidden at this
            width). Names wrap rather than truncate — identity must stay
            visible. The desktop/landscape grid table is rendered below. */}
        <div className="sm:hidden">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2 text-[15px] font-semibold leading-tight break-words">
              {playerHref ? <Link href={playerHref} className="underline-offset-4 hover:text-primary hover:underline">{entry.name}</Link> : entry.name}
              {hasHoles ? (
                <button type="button" onClick={onToggle} aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} ${entry.name} scorecard`} className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground">
                  Card <ChevronDown className={cn("h-3 w-3 transition-transform", isOpen && "rotate-180")} aria-hidden />
                </button>
              ) : null}
            </span>
            {showFlight &&
              (color ? (
                <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums", color.badge)}>
                  {flightLabel ?? entry.flight ?? "—"}
                </span>
              ) : (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {flightLabel ?? entry.flight ?? "—"}
                </span>
              ))}
          </div>
          <div className="mt-1.5 grid grid-cols-5 gap-1">
            {buildMobileStats(entry, card, scoringMode, isPlayerLive).map((s) => (
              <MobileStat key={s.label} label={s.label} value={s.value} valueClass={s.valueClass} />
            ))}
          </div>
          {showPlayerPurse && (
            <div className="mt-1 text-right text-[11px] tabular-nums text-muted-foreground">
              Purse {entry.purse}
            </div>
          )}
        </div>
        {/* Desktop / landscape grid table (sm+). Identical cells to the
            previous single-grid row; the portrait block above is hidden at
            this width, so the existing richer table is fully preserved. */}
        <div className={cn("hidden items-center gap-2 sm:grid", cols.sm)}>
          <span className="font-medium tabular-nums text-muted-foreground">
            {entry.positionLabel ?? "—"}
          </span>
          <span className="flex min-w-0 items-center gap-2 truncate font-medium">
            {playerHref ? <Link href={playerHref} className="truncate underline-offset-4 hover:text-primary hover:underline">{entry.name}</Link> : <span className="truncate">{entry.name}</span>}
            {hasHoles ? (
              <button type="button" onClick={onToggle} aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} ${entry.name} scorecard`} className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground">
                Card <ChevronDown className={cn("h-3 w-3 transition-transform", isOpen && "rotate-180")} aria-hidden />
              </button>
            ) : null}
          </span>
          {showFlight && (
            color ? (
              <span className="hidden justify-end sm:flex">
                <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums", color.badge)}>
                  {flightLabel ?? entry.flight ?? "—"}
                </span>
              </span>
            ) : (
              <span className="hidden truncate text-right text-xs tabular-nums text-muted-foreground sm:block">
                {flightLabel ?? entry.flight ?? "—"}
              </span>
            )
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
          {showPlayerPurse && (
            <span className="text-right tabular-nums text-muted-foreground">{entry.purse}</span>
          )}
        </div>
      </div>
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
    </div>
  );
}
