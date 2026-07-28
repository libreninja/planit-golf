// League weekly/live results + season points.
//
// Two source tables back a league round's view:
//   - igc_league_performances  — the SCORECARD FACT: one row per player-round
//     (hole-by-hole gross/net scores, to-par, totals, holes completed). A
//     player has exactly one scorecard for a round, regardless of how many
//     competitions rank it.
//   - igc_league_results       — the RESULT MEMBERSHIPS: one row per
//     player-round × competition (gross or net), carrying only the placement
//     (flight, finishing position, points, purse). Two rows per player-round
//     for individual weeks (gross + net); none for team/scramble weeks.
//
// Golf Genius models a league round as TWO individual tournaments — Gross and
// Net — each scoped by flight (men's: Flight 1/2/3; women's: single Overall
// field). The SAME player appears in both with a byte-identical scorecard; only
// the placement (position/points/purse) differs. So the UI shows BOTH
// competitions per flight but expands ONE shared scorecard per player.
//
// Completed rounds read from the persisted tables above; an in-progress round
// (event_date is today) is fetched live from BOTH GG tournaments and merged
// into the same view model. Par is NOT stored — derived per hole as
// gross - gross-to-par (both persisted), so no schema change is needed for a
// hole-by-hole card.
//
// Season points (Men's only) come from a separate cumulative snapshot,
// igc_league_season_points, which the sync builds by summing every round's
// weekly total_points across both competitions (GG exposes no cumulative
// endpoint). Women's has no points race; no snapshot is fabricated.

import { createClient } from "@/lib/supabase/server";
import { makeGolfGeniusRequest } from "@/lib/gg/client";

// ---------------------------------------------------------------------------
// Shared view-model types
// ---------------------------------------------------------------------------

// One hole on a player's scorecard.
export interface HoleScore {
  hole: number; // 1..18
  par: number | null;
  gross: number | null;
  net: number | null;
  toPar: number | null; // net to-par for THIS hole (delta)
  cumulativeToPar: number | null; // running net to-par through this hole
}

// The scorecard fact: one per player-round. Underlying round independent of
// which competition (gross/net) ranks it. Carries hole-by-hole data and the
// net/gross totals only — NOT the competition placement (that lives on
// WeeklyResultEntry). The view looks a scorecard up by `key` from the flight's
// deduped scorecard list, so a player ranked in both Gross and Net has ONE
// expandable card, not two.
export interface WeeklyScorecard {
  key: string; // stable per-player key (memberCardId ?? `name:${name}`)
  memberCardId: string | null;
  name: string;
  netTotal: number | null;
  grossTotal: number | null;
  toParNet: number | null; // total net to-par
  toParGross: number | null; // total gross to-par
  holesCompleted: number;
  scorecardStatus: string | null;
  isLive: boolean; // round still in progress for this player
  holes: HoleScore[];
}

// A competition result membership: how a player placed in ONE competition
// (gross or net) within a flight. Carries only the placement; the scorecard
// is shared (looked up by `key`).
export interface WeeklyResultEntry {
  key: string; // matches a WeeklyScorecard.key in the same flight
  name: string;
  positionLabel: string | null; // "1", "T2", "—" (raw, for display)
  positionOrder: number; // numeric, for sorting; unplaced -> large
  points: number | null;
  purse: string | null;
}

// One competition (gross or net) within a flight: the ordered result list.
export interface WeeklyCompetition {
  competition: "gross" | "net";
  players: WeeklyResultEntry[];
}

export interface WeeklyFlight {
  name: string; // "Flight 1/2/3" (men's) / "Overall" (women's)
  competitions: WeeklyCompetition[]; // net first, then gross
  scorecards: WeeklyScorecard[]; // deduped per player-round in this flight
}

export interface WeeklyRoundResult {
  eventName: string;
  eventDate: string | null;
  flights: WeeklyFlight[];
  hasResults: boolean;
  isTeamEvent: boolean; // scramble/team week — no individual results
  // live = at least one player mid-round; completed = all done; not_started = no aggregates
  status: "live" | "completed" | "not_started" | "unknown";
}

export interface SeasonPointsRow {
  rank: number | null; // derived cumulative season rank
  previousRank: number | null;
  playerName: string | null;
  totalPoints: number | null;
  eventsPlayed: number;
  wins: number;
  pointsBehind: number | null;
  movement: "up" | "down" | "stable" | "new" | null; // derived from rank vs previous
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const BOTTOM = Number.MAX_SAFE_INTEGER;

// Finishing position from GG's `position` ("1", "T2", "--"). `rank` is only a
// within-flight list index and is NOT the position, so callers must pass
// `position`. Unplaced players sort to the bottom.
export function positionOrder(position: unknown): number {
  if (position === null || position === undefined || position === "") return BOTTOM;
  const s = String(position).trim();
  if (s === "--" || s === "-" || s.toLowerCase() === "nc") return BOTTOM;
  const n = parseInt(s.replace(/^T/i, ""), 10);
  return Number.isFinite(n) ? n : BOTTOM;
}

export function positionLabelOf(position: unknown): string | null {
  if (position === null || position === undefined || position === "") return null;
  const s = String(position).trim();
  if (s === "--" || s === "") return null;
  return s;
}

// Stable per-player key for joining a result membership to its scorecard.
// Aggregates carry member_card_id; fall back to a name key if absent so a
// scorecard is still reachable (and still deduped) without duplicating the
// hole-by-hole data across the two competitions.
export function playerKey(memberCardId: string | null | undefined, name: string): string {
  return memberCardId ? memberCardId : `name:${name}`;
}

function parseNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

// Build the hole-by-hole scorecard from the per-hole arrays. Par is derived as
// gross - gross-to-par (both stored); the running net to-par is the cumulative
// sum of the per-hole net-to-par deltas. Holes beyond what the player has
// reached are still listed (for a 9-hole league the back 9 are null) so the
// card has consistent length.
export function buildHoles(
  grossScores: (number | null)[] | null,
  netScores: (number | null)[] | null,
  toParNet: (number | null)[] | null,
  toParGross: (number | null)[] | null,
): HoleScore[] {
  const len = Math.max(
    grossScores?.length ?? 0,
    netScores?.length ?? 0,
    toParNet?.length ?? 0,
    toParGross?.length ?? 0,
    0,
  );
  const holes: HoleScore[] = [];
  let running = 0;
  let hasAny = false;
  for (let i = 0; i < len; i++) {
    const gross = grossScores?.[i] ?? null;
    const net = netScores?.[i] ?? null;
    const tpn = toParNet?.[i] ?? null;
    const tpg = toParGross?.[i] ?? null;
    const par =
      gross !== null && tpg !== null ? gross - tpg
      : net !== null && tpn !== null && tpg === null ? null
      : null;
    if (tpn !== null) { running += tpn; hasAny = true; }
    holes.push({
      hole: i + 1,
      par,
      gross,
      net,
      toPar: tpn,
      cumulativeToPar: hasAny && tpn !== null ? running : null,
    });
  }
  return holes;
}

function isPartialRound(holesCompleted: number, totalHoles: number): boolean {
  return holesCompleted > 0 && holesCompleted < totalHoles;
}

// Trim every scorecard to the round's actual hole count. GG returns 18-slot
// arrays with trailing nulls for the unplayed holes of a shorter course
// (Interbay league rounds are 9 holes), so the course length is the largest
// leading non-null prefix any player in the round reached — `holesCompleted`
// on a finished card equals the course length. Trimming renders only the
// holes that belong to the round (no 18-hole assumption) and makes the live
// "thru"/"F" detection compare against the real course length. `recomputeLive`
// re-derives the in-progress flag after trimming (live path); the completed-
// round DB path passes false so finished cards stay "F".
function trimToRoundHoleCount(scorecards: WeeklyScorecard[], recomputeLive: boolean): void {
  const roundHoles = scorecards.reduce((m, c) => Math.max(m, c.holesCompleted), 0);
  if (roundHoles <= 0) return;
  for (const c of scorecards) {
    if (c.holes.length > roundHoles) c.holes = c.holes.slice(0, roundHoles);
    if (recomputeLive) c.isLive = isPartialRound(c.holesCompleted, roundHoles);
  }
}

// ---------------------------------------------------------------------------
// Season points (Men's) — from the persisted snapshot
// ---------------------------------------------------------------------------

export async function getLeagueSeasonPointsFromDB(
  leagueKey: string,
): Promise<SeasonPointsRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("igc_league_season_points")
    .select(
      "position, previous_position, player_name, total_points, events_played, wins, points_behind",
    )
    .eq("league_key", leagueKey)
    .order("position", { ascending: true, nullsFirst: false })
    .order("total_points", { ascending: false });

  if (error || !data) return [];

  return data.map((r) => {
    const rank = r.position;
    const prev = r.previous_position;
    let movement: SeasonPointsRow["movement"] = null;
    if (rank !== null && prev !== null) {
      movement = prev > rank ? "up" : prev < rank ? "down" : "stable";
    } else if (rank !== null && prev === null && (r.total_points ?? 0) > 0) {
      movement = "new";
    }
    return {
      rank,
      previousRank: prev,
      playerName: r.player_name,
      totalPoints: r.total_points !== null ? Number(r.total_points) : null,
      eventsPlayed: r.events_played ?? 0,
      wins: r.wins ?? 0,
      pointsBehind: r.points_behind !== null ? Number(r.points_behind) : null,
      movement,
    };
  });
}

// Whether a league has any persisted season-points rows (Men's does, Women's
// does not — GG provides no cumulative season points for the Women's league).
export async function hasSeasonPoints(leagueKey: string): Promise<boolean> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("igc_league_season_points")
    .select("*", { count: "exact", head: true })
    .eq("league_key", leagueKey);
  return (count ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Weekly results — completed round, from persisted performances + results
// ---------------------------------------------------------------------------

// A week's completed individual results, grouped by flight with both the Net
// and Gross competitions, read from igc_league_performances (scorecards) and
// igc_league_results (gross/net placements). Returns isTeamEvent=true (with no
// flights) when the week is a team/scramble event the sync recorded as a
// schedule row only.
export async function getLeagueWeeklyResultsFromDB(
  leagueKey: string,
  weekNumber: number,
): Promise<WeeklyRoundResult | null> {
  const supabase = await createClient();

  const { data: event } = await supabase
    .from("igc_league_events")
    .select("event_name, event_date, status, gg_tournament_id")
    .eq("league_key", leagueKey)
    .eq("week_number", weekNumber)
    .maybeSingle();
  if (!event) return null;

  const eventName = event.event_name;
  const eventDate = event.event_date;

  // Team/scramble weeks: the sync stores a schedule row with no individual
  // tournament (gg_tournament_id null) and no performances. gg_tournament_id
  // IS NULL is the authoritative team-event signal — the sync sets it null
  // only for team/side weeks — so we don't depend on event_name wording.
  const isTeamEvent = event.gg_tournament_id === null;

  if (isTeamEvent) {
    return {
      eventName,
      eventDate,
      flights: [],
      hasResults: false,
      isTeamEvent: true,
      status: "completed",
    };
  }

  // Scorecards: one row per player-round. Only the hole-by-hole / total fields
  // are read here — the competition placement (points/position/purse) comes
  // from igc_league_results, NOT these legacy columns.
  const { data: perfs, error: perfError } = await supabase
    .from("igc_league_performances")
    .select(
      "player_name, member_card_id, flight_name, gross_scores, net_scores, to_par_net, to_par_gross, net_total, gross_total, to_par_net_total, to_par_gross_total, holes_completed, scorecard_status",
    )
    .eq("league_key", leagueKey)
    .eq("week_number", weekNumber)
    .limit(1000);

  // Result memberships: gross + net placements per flight.
  const { data: results, error: resultsError } = await supabase
    .from("igc_league_results")
    .select("member_card_id, player_name, competition, flight_name, position_label, points, purse")
    .eq("league_key", leagueKey)
    .eq("week_number", weekNumber)
    .order("flight_name", { ascending: true, nullsFirst: false })
    .order("competition", { ascending: true })
    .order("flight_position", { ascending: true, nullsFirst: false })
    .order("player_name", { ascending: true })
    .limit(2000);

  if (perfError || resultsError || (!perfs || perfs.length === 0) || (!results || results.length === 0)) {
    return {
      eventName,
      eventDate,
      flights: [],
      hasResults: false,
      isTeamEvent: false,
      status: "unknown",
    };
  }

  // Scorecard lookup keyed by playerKey (memberCardId ?? name).
  const scorecardByKey = new Map<string, WeeklyScorecard>();
  for (const p of perfs) {
    const name = p.player_name;
    const key = playerKey(p.member_card_id, name);
    // A player may have one performance row; if duplicates ever appear, keep
    // the one with the most completed holes so a partial card isn't preferred.
    const holes = buildHoles(p.gross_scores, p.net_scores, p.to_par_net, p.to_par_gross);
    const holesCompleted = holes.filter((h) => h.gross !== null || h.net !== null).length;
    const existing = scorecardByKey.get(key);
    if (existing && existing.holesCompleted >= holesCompleted) continue;
    scorecardByKey.set(key, {
      key,
      memberCardId: p.member_card_id ?? null,
      name,
      netTotal: p.net_total ?? null,
      grossTotal: p.gross_total ?? null,
      toParNet: p.to_par_net_total ?? null,
      toParGross: p.to_par_gross_total ?? null,
      holesCompleted,
      scorecardStatus: p.scorecard_status ?? null,
      isLive: false,
      holes,
    });
  }

  // Render only the holes that belong to this round/course (Interbay plays 9;
  // GG returns 18-slot arrays with trailing nulls). Completed rounds leave
  // isLive=false so finished cards show "F".
  trimToRoundHoleCount([...scorecardByKey.values()], false);

  // Group result memberships by flight, then competition (net before gross).
  // The `.order('competition')` is alphabetic but we re-key explicitly so the
  // final competitions array is always [net, gross] when both are present.
  const byFlight = new Map<string, { net: WeeklyResultEntry[]; gross: WeeklyResultEntry[]; scorecards: Map<string, WeeklyScorecard> }>();
  const ensureFlight = (flightName: string) => {
    let f = byFlight.get(flightName);
    if (!f) {
      f = { net: [], gross: [], scorecards: new Map() };
      byFlight.set(flightName, f);
    }
    return f;
  };

  for (const r of results) {
    const flightName = r.flight_name?.trim() || "Overall";
    const name = r.player_name;
    const key = playerKey(r.member_card_id, name);
    const entry: WeeklyResultEntry = {
      key,
      name,
      positionLabel: positionLabelOf(r.position_label),
      positionOrder: positionOrder(r.position_label),
      points: r.points !== null ? Number(r.points) : null,
      purse: r.purse ?? null,
    };
    const f = ensureFlight(flightName);
    if (r.competition === "gross") f.gross.push(entry);
    else f.net.push(entry);
    // Attach this player's shared scorecard to the flight (deduped by key).
    const card = scorecardByKey.get(key);
    if (card && !f.scorecards.has(key)) f.scorecards.set(key, card);
  }

  const flights: WeeklyFlight[] = [...byFlight.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([name, f]) => {
      const sortEntries = (es: WeeklyResultEntry[]) =>
        es.sort((a, b) => a.positionOrder - b.positionOrder || a.name.localeCompare(b.name));
      const competitions: WeeklyCompetition[] = [];
      if (f.net.length > 0) competitions.push({ competition: "net", players: sortEntries(f.net) });
      if (f.gross.length > 0) competitions.push({ competition: "gross", players: sortEntries(f.gross) });
      return {
        name,
        competitions,
        scorecards: [...f.scorecards.values()],
      };
    });

  return {
    eventName,
    eventDate,
    flights,
    hasResults: flights.some((f) => f.competitions.some((c) => c.players.length > 0)),
    isTeamEvent: false,
    status: "completed",
  };
}

// ---------------------------------------------------------------------------
// Weekly results — live round, fetched fresh from Golf Genius (both comps)
// ---------------------------------------------------------------------------

// Resolve the GG round + BOTH individual tournaments for a league week. The
// sync stores gg_round_id/gg_gross_tournament_id/gg_net_tournament_id on
// igc_league_events for every round it processes, so we usually have them
// directly. If a round was never synced, fall back to resolving the round by
// event_date and picking the gross + net individual tournaments (mirroring the
// sync). Returns null for team weeks (no individual tournaments).
async function resolveLiveIds(
  leagueKey: string,
  weekNumber: number,
): Promise<{ ggEventId: string; ggRoundId: string; grossTournamentId: string | null; netTournamentId: string | null } | null> {
  const supabase = await createClient();
  const { data: ev } = await supabase
    .from("igc_league_events")
    .select("gg_event_id, gg_round_id, gg_gross_tournament_id, gg_net_tournament_id, event_date")
    .eq("league_key", leagueKey)
    .eq("week_number", weekNumber)
    .maybeSingle();
  if (!ev || !ev.gg_event_id) return null;

  if (ev.gg_round_id && (ev.gg_gross_tournament_id || ev.gg_net_tournament_id)) {
    return {
      ggEventId: ev.gg_event_id,
      ggRoundId: ev.gg_round_id,
      grossTournamentId: ev.gg_gross_tournament_id ?? null,
      netTournamentId: ev.gg_net_tournament_id ?? null,
    };
  }

  // Resolve the round by date, then pick the gross + net individual tournaments.
  const rounds = await makeGolfGeniusRequest<{ round: { id: string; date?: string; status?: string } }[]>(
    { endpoint: `/events/${ev.gg_event_id}/rounds` },
  );
  const list = (Array.isArray(rounds) ? rounds : []).map((r) => r.round ?? r);
  const round = list.find((r) => r.date && r.date.slice(0, 10) === (ev.event_date ?? "").slice(0, 10));
  if (!round) return null;

  const tournaments = await makeGolfGeniusRequest<{ event: { id: string; name: string } }[]>(
    { endpoint: `/events/${ev.gg_event_id}/rounds/${round.id}/tournaments` },
  );
  const named = (Array.isArray(tournaments) ? tournaments : []).map((t) => t.event).filter((e) => e?.id && e?.name);
  const isSide = (n: string) => /closest to the pin|kp hole|team|scramble/i.test(n.toLowerCase());
  const individual = named.filter((e) => !isSide(e.name));
  const gross = individual.find((e) => /gross/i.test(e.name)) || null;
  const net = individual.find((e) => /net/i.test(e.name)) || (individual.length === 1 ? individual[0] : null);
  if (!gross && !net) return null;

  return {
    ggEventId: ev.gg_event_id,
    ggRoundId: round.id,
    grossTournamentId: gross?.id ?? null,
    netTournamentId: net?.id ?? null,
  };
}

interface GGAggregate {
  name?: string;
  position?: string | number | null;
  points?: string | number | null;
  purse?: string | null;
  member_cards?: { member_card_id_str?: string }[];
  net_scores?: (number | null)[];
  gross_scores?: (number | null)[];
  to_par_net?: (number | null)[];
  to_par_gross?: (number | null)[];
  totals?: {
    net_scores?: { out?: number | null; in?: number | null; total?: number | null };
    gross_scores?: { out?: number | null; in?: number | null; total?: number | null };
    to_par_net?: { out?: number | null; in?: number | null; total?: number | null };
    to_par_gross?: { out?: number | null; in?: number | null; total?: number | null };
  };
  scorecard_statuses?: { status?: string }[];
}
interface GGScope { name?: string; aggregates?: GGAggregate[]; }
interface GGResults { event?: { scopes?: GGScope[] }; }

// Parse ONE GG tournament-results payload into per-flight result entries (for
// the given competition) plus per-player scorecards. The scorecard is the same
// fact whether the tournament is Gross or Net, so the caller merges the two
// parses and keeps one scorecard per player.
function parseGGTournament(
  results: GGResults,
  competition: "gross" | "net",
): {
  competition: "gross" | "net";
  entriesByFlight: Map<string, WeeklyResultEntry[]>;
  scorecards: Map<string, WeeklyScorecard>;
} {
  const scopes = results?.event?.scopes ?? [];
  const entriesByFlight = new Map<string, WeeklyResultEntry[]>();
  const scorecards = new Map<string, WeeklyScorecard>();

  for (const scope of scopes) {
    const flightName = scope.name?.trim() || "Overall";
    for (const a of scope.aggregates ?? []) {
      if (!a.name) continue;
      const memberCardId = a.member_cards?.[0]?.member_card_id_str ?? null;
      const key = playerKey(memberCardId, a.name);
      const holes = buildHoles(a.gross_scores ?? null, a.net_scores ?? null, a.to_par_net ?? null, a.to_par_gross ?? null);
      const holesCompleted = holes.filter((h) => h.gross !== null || h.net !== null).length;
      const totalHoles = holes.length || 18;

      // The scorecard is shared across competitions; keep it once. Both
      // tournaments carry identical cards, so whichever parse lands first
      // wins and the other is a no-op (deduped by key).
      if (!scorecards.has(key)) {
        scorecards.set(key, {
          key,
          memberCardId,
          name: a.name,
          netTotal: a.totals?.net_scores?.out ?? a.totals?.net_scores?.total ?? null,
          grossTotal: a.totals?.gross_scores?.out ?? a.totals?.gross_scores?.total ?? null,
          toParNet: a.totals?.to_par_net?.out ?? a.totals?.to_par_net?.total ?? null,
          toParGross: a.totals?.to_par_gross?.out ?? a.totals?.to_par_gross?.total ?? null,
          holesCompleted,
          scorecardStatus: a.scorecard_statuses?.[0]?.status ?? null,
          isLive: isPartialRound(holesCompleted, totalHoles),
          holes,
        });
      }

      const entry: WeeklyResultEntry = {
        key,
        name: a.name,
        positionLabel: positionLabelOf(a.position),
        positionOrder: positionOrder(a.position),
        points: parseNum(a.points),
        purse: a.purse ?? null,
      };
      if (!entriesByFlight.has(flightName)) entriesByFlight.set(flightName, []);
      entriesByFlight.get(flightName)!.push(entry);
    }
  }

  return { competition, entriesByFlight, scorecards };
}

// Fetch the fresh GG results for a league week (the live round) from BOTH the
// Gross and Net tournaments and merge them into one view model — each flight
// shows both competitions, with one shared scorecard per player. Used by the
// live polling route handler.
export async function fetchLeagueLiveResults(
  leagueKey: string,
  weekNumber: number,
): Promise<WeeklyRoundResult | null> {
  const ids = await resolveLiveIds(leagueKey, weekNumber);
  if (!ids) return null;
  // No individual tournaments at all → a team week; not live-eligible, but be
  // honest if ever called directly.
  if (!ids.grossTournamentId && !ids.netTournamentId) return null;

  const supabase = await createClient();
  const { data: ev } = await supabase
    .from("igc_league_events")
    .select("event_name, event_date")
    .eq("league_key", leagueKey)
    .eq("week_number", weekNumber)
    .maybeSingle();
  const eventName = ev?.event_name ?? "Live Round";
  const eventDate = ev?.event_date ?? null;

  // Fetch each tournament; a missing/empty payload (e.g. one competition not
  // yet scored live) degrades to that competition simply not rendering.
  const fetchTournament = async (tournamentId: string, competition: "gross" | "net") => {
    try {
      const results = await makeGolfGeniusRequest<GGResults>({
        endpoint: `/events/${ids.ggEventId}/rounds/${ids.ggRoundId}/tournaments/${tournamentId}.json`,
      });
      return parseGGTournament(results, competition);
    } catch (err) {
      console.error(`[live] ${competition} tournament fetch failed (${tournamentId}):`, err);
      return null;
    }
  };

  const gross = ids.grossTournamentId ? await fetchTournament(ids.grossTournamentId, "gross") : null;
  const net = ids.netTournamentId ? await fetchTournament(ids.netTournamentId, "net") : null;
  if (!gross && !net) return null;

  // Round-wide scorecard map: deduped by player key across the two tournament
  // parses (the card is identical in Gross and Net — one fact). Trimming here
  // once, round-wide, renders only the holes that belong to the course
  // (Interbay plays 9; GG returns 18-slot arrays with trailing nulls) and
  // recomputes the in-progress flag against the real course length.
  const allScorecards = new Map<string, WeeklyScorecard>();
  for (const source of [net?.scorecards, gross?.scorecards]) {
    if (!source) continue;
    for (const [key, card] of source) if (!allScorecards.has(key)) allScorecards.set(key, card);
  }
  trimToRoundHoleCount([...allScorecards.values()], true);
  const anyLive = [...allScorecards.values()].some((c) => c.isLive);

  // Merge per flight. Scorecards are deduped across the two parses (identical
  // data); we always emit competitions [net, gross].
  const flightNames = new Set<string>([
    ...(net?.entriesByFlight.keys() ?? []),
    ...(gross?.entriesByFlight.keys() ?? []),
  ]);

  const flights: WeeklyFlight[] = [];
  let anyPlayers = false;

  for (const flightName of flightNames) {
    const netEntries = net?.entriesByFlight.get(flightName) ?? [];
    const grossEntries = gross?.entriesByFlight.get(flightName) ?? [];
    const sortEntries = (es: WeeklyResultEntry[]) =>
      es.sort((a, b) => a.positionOrder - b.positionOrder || a.name.localeCompare(b.name));

    // This flight's shared scorecards (one per player), drawn from the
    // round-wide trimmed map.
    const scorecardMap = new Map<string, WeeklyScorecard>();
    for (const e of [...netEntries, ...grossEntries]) {
      const card = allScorecards.get(e.key);
      if (card && !scorecardMap.has(e.key)) scorecardMap.set(e.key, card);
    }

    const competitions: WeeklyCompetition[] = [];
    if (netEntries.length > 0) competitions.push({ competition: "net", players: sortEntries(netEntries) });
    if (grossEntries.length > 0) competitions.push({ competition: "gross", players: sortEntries(grossEntries) });
    if (competitions.length === 0) continue;

    if (competitions.some((c) => c.players.length > 0)) anyPlayers = true;
    flights.push({
      name: flightName,
      competitions,
      scorecards: [...scorecardMap.values()],
    });
  }

  flights.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const status: WeeklyRoundResult["status"] = !anyPlayers
    ? "not_started"
    : anyLive
      ? "live"
      : "completed";

  return { eventName, eventDate, flights, hasResults: anyPlayers, isTeamEvent: false, status };
}