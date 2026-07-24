#!/usr/bin/env node
// Sync IGC league data from Golf Genius to the PlanIt database.
// Usage: node scripts/sync-igc-league.mjs [mens|womens]
//
// Persists the AUTHORITATIVE per-round competition result (flight, finishing
// position, points awarded, gross/net hole-by-hole scores, to-par, totals,
// purse, scoring status) plus a season-points snapshot and a member-card→name
// roster cache. The league pages render from this stored data instead of
// re-deriving a "leaderboard" from birdie/double counts.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_KEY = process.env.GOLF_GENIUS_API_KEY;
const BASE_URL = process.env.GOLF_GENIUS_BASE_URL || 'https://www.golfgenius.com';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env vars: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}
if (!API_KEY) {
  console.error('Missing env var: GOLF_GENIUS_API_KEY required');
  process.exit(1);
}

const leagueKey = process.argv[2];
if (!leagueKey || !['mens', 'womens'].includes(leagueKey)) {
  console.error('Usage: node sync-igc-league.mjs [mens|womens]');
  process.exit(1);
}

const LEAGUES = {
  mens: { seasonId: process.env.IGC_MENS_SEASON_ID, categoryId: process.env.IGC_MENS_CATEGORY_ID, name: "Men's League" },
  womens: { seasonId: process.env.IGC_WOMENS_SEASON_ID, categoryId: process.env.IGC_WOMENS_CATEGORY_ID, name: "Women's League" },
};
const config = LEAGUES[leagueKey];
if (!config.seasonId || !config.categoryId) {
  console.error(`Missing env vars for ${leagueKey} league`);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function ggRequest(endpoint, queryParams = {}) {
  const params = new URLSearchParams();
  Object.entries(queryParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.append(key, String(value));
  });
  const queryString = params.toString();
  const url = `${BASE_URL}/api_v2/${API_KEY}${endpoint}${queryString ? '?' + queryString : ''}`;
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GG API error (${response.status}): ${errorText.slice(0, 200)}`);
  }
  return response.json();
}

// Round names that are not regular-season points rounds (exclusion list works
// for BOTH leagues: men's "Points Season - Week N" and women's "Regular Season
// Week N", since neither contains these needles).
const NON_POINTS = ['preseason', 'post season', 'postseason', 'club championship', 'fun week', 'horse race', 'no points'];

// Pick the league's INDIVIDUAL competition tournament. The league scores NET
// (handicap), so prefer the net individual tournament ("Net Regular Season",
// "Net Individual Play"). Exclude side/skill competitions ("Closest to the
// Pin", "KP HOLE #n") and TEAM events ("Net Team Scramble", "Gross Team
// Scramble") — team weeks are a separate result concern and their aggregates
// are team strings, not individual scorecards, so storing them would pollute
// the per-player performance table. When no individual tournament exists (a
// scramble week), returns null so the caller records the schedule row only.
function isSideOrTeamCompetition(name) {
  const n = name.toLowerCase();
  return n.includes('closest to the pin') || n.includes('kp hole') || n.includes('team') || n.includes('scramble');
}
function pickLeagueTournament(tournaments) {
  const named = tournaments.map((t) => t.event).filter((e) => e && e.id && e.name);
  const individual = named.filter((e) => !isSideOrTeamCompetition(e.name.toLowerCase()));
  return individual.find((e) => e.name.toLowerCase().includes('net'))
    || individual[0]
    || null;
}

function parseNum(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : null;
}
function parseIntOrNull(value) {
  const n = parseNum(value);
  return n === null ? null : Math.trunc(n);
}
// Authoritative finishing position from GG's `position` field ("1", "T2",
// "--" for ineligible/guest/no-card). `rank` is only the within-flight list
// index (including ineligible players), so we must NOT use it as the position.
// Returns null for unplaced players so they sort to the bottom and never count
// as a flight win.
function parsePosition(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  if (s === '--' || s === '-' || s.toLowerCase() === 'nc') return null;
  const n = parseInt(s.replace(/^T/i, ''), 10);
  return Number.isFinite(n) ? n : null;
}
// Competition ranking (1224) by total_points descending: tied totals share
// the lower rank. Returns member_card_id -> rank.
function rankByTotalPoints(entries) {
  const sorted = [...entries].sort((a, b) => (Number(b.total_points) || 0) - (Number(a.total_points) || 0));
  const rankById = new Map();
  let lastPoints = null, lastRank = 0, count = 0;
  for (const e of sorted) {
    count++;
    const pts = Number(e.total_points) || 0;
    if (lastPoints === null || pts !== lastPoints) { lastRank = count; lastPoints = pts; }
    rankById.set(e.member_card_id, lastRank);
  }
  return rankById;
}
function countCompletedHoles(scores) {
  if (!Array.isArray(scores)) return 0;
  return scores.filter((x) => x !== null && x !== undefined).length;
}
function totalOut(totals, key) {
  return totals?.[key]?.out ?? totals?.[key]?.total ?? null;
}

// Map a GG round status to the igc_league_events.status CHECK domain.
function roundStatus(round) {
  if (round.status === 'completed') return 'finalized';
  if (round.status === 'not started') return 'upcoming';
  return 'live'; // in-progress / any other active state
}

async function syncLeague() {
  console.log(`Syncing ${config.name}...`);

  const eventsResponse = await ggRequest('/events', { season_id: config.seasonId, category_id: config.categoryId });
  if (!Array.isArray(eventsResponse) || eventsResponse.length === 0) {
    console.log('  No events found');
    return;
  }

  // Only the main league season event ("IGC Mens League 2026" / "IGC Women's
  // League 2026"). "league" + the league needle excludes most side events; we
  // also exclude "toptracer" so the indoor simulator league ("Women's Toptracer
  // League") does not pollute the women's week numbers / season snapshot.
  const leagueFilter = leagueKey === 'mens' ? 'mens' : 'women';
  const events = eventsResponse
    .filter((e) => {
      const name = e.event?.name?.toLowerCase() || '';
      return name.includes('league') && name.includes(leagueFilter) && !name.includes('toptracer');
    })
    .sort((a, b) => new Date(a.event.start_date || 0) - new Date(b.event.start_date || 0));

  console.log(`  Found ${events.length} league event(s)`);

  // member_card_id -> { name, email, handicap_index }. The /roster endpoint
  // returns only registered members (26 for the men's event — far fewer than
  // the ~150 who actually play), and wraps each entry as { member: {...} }.
  // Aggregates carry member_card_id_str + name for every player who appeared,
  // so we merge roster (email/handicap) with aggregate-sourced names to get a
  // complete cache for resolving season_points member_card_id -> name.
  const memberInfo = new Map();
  const mergeMember = (id, { name, email, handicapIndex } = {}) => {
    if (!id) return;
    const existing = memberInfo.get(id) || { name: null, email: null, handicapIndex: null };
    memberInfo.set(id, {
      name: existing.name || name || null,
      email: existing.email || email || null,
      handicapIndex: existing.handicapIndex || handicapIndex || null,
    });
  };
  let lastSeasonPoints = null; // latest completed round's cumulative standings
  let prevSeasonPoints = null; // the completed round before that

  for (const eventWrapper of events) {
    const event = eventWrapper.event;
    console.log(`  Processing event: ${event.name}`);

    // Cache the roster (member_card_id -> name/email/handicap). GG wraps each
    // roster entry in { member: {...} }, so unwrap before reading fields.
    try {
      const roster = await ggRequest(`/events/${event.id}/roster`, { per_page: 500 });
      const rosterArr = Array.isArray(roster) ? roster : [];
      let rosterCount = 0;
      for (const entry of rosterArr) {
        const m = entry?.member || entry;
        const memberCardId = m.member_card_id;
        if (!memberCardId) continue;
        rosterCount++;
        const name = m.name || [m.first_name, m.last_name].filter(Boolean).join(' ') || null;
        mergeMember(memberCardId, { name, email: m.email || null, handicapIndex: m.handicap?.handicap_index || null });
      }
      console.log(`    Roster: ${rosterCount} members`);
    } catch (err) {
      console.error(`    Roster fetch failed: ${err.message}`);
    }

    const roundsResponse = await ggRequest(`/events/${event.id}/rounds`);
    if (!Array.isArray(roundsResponse) || roundsResponse.length === 0) {
      console.log(`    No rounds found`);
      continue;
    }
    const pointsRounds = roundsResponse
      .filter((r) => !NON_POINTS.some((n) => (r.round?.name?.toLowerCase() || '').includes(n)))
      .map((r) => r.round)
      .sort((a, b) => (a.index || 0) - (b.index || 0));

    // Course par for the (secondary) birdie/double counts only.
    let parData = [];
    try {
      const coursesData = await ggRequest(`/events/${event.id}/courses`);
      parData = coursesData?.courses?.[0]?.tees?.[0]?.hole_data?.par || [];
    } catch { /* par data not critical */ }

    let weekNumber = 0;
    for (const round of pointsRounds) {
      weekNumber++;
      console.log(`    Processing week ${weekNumber}: ${round.name} (${round.date}, ${round.status})`);
      try {
        const tournamentsResponse = await ggRequest(`/events/${event.id}/rounds/${round.id}/tournaments`);
        if (!Array.isArray(tournamentsResponse) || tournamentsResponse.length === 0) continue;
        const tournament = pickLeagueTournament(tournamentsResponse);
        if (!tournament) {
          // No individual competition (e.g. a scramble/team week). Record the
          // schedule row but skip per-player performances so team aggregates
          // don't pollute the individual-results table.
          console.log(`      No individual tournament for ${round.name} (team/side event)`);
          await supabase.from('igc_league_events').upsert({
            league_key: leagueKey, week_number: weekNumber, gg_event_id: event.id,
            gg_round_id: round.id, gg_tournament_id: null, event_name: round.name,
            event_date: round.date, status: roundStatus(round),
            results_released: round.settings?.results_released ?? null,
          }, { onConflict: 'league_key,week_number' });
          continue;
        }
        const tournamentId = tournament.id;

        // Fetch results; retry completed rounds that return empty aggregates
        // (GG intermittently throttles rapid sequential calls).
        const resultsUrl = `/events/${event.id}/rounds/${round.id}/tournaments/${tournamentId}.json`;
        const isCompleted = round.status === 'completed';
        let results = null;
        let hasAggregates = false;
        for (let attempt = 1; attempt <= 4; attempt++) {
          results = await ggRequest(resultsUrl);
          hasAggregates = (results?.event?.scopes || []).some((s) => (s.aggregates || []).some((a) => a && a.name));
          if (hasAggregates) break;
          if (!isCompleted) break;
          if (attempt < 4) await new Promise((r) => setTimeout(r, 750 * attempt));
        }
        if (!hasAggregates) {
          console.log(`      No aggregates${isCompleted ? ' after retries' : ''} for ${round.name}`);
          // Still upsert the event row (schedule) so future rounds are listed.
          await supabase.from('igc_league_events').upsert({
            league_key: leagueKey, week_number: weekNumber, gg_event_id: event.id,
            gg_round_id: round.id, gg_tournament_id: tournamentId,
            event_name: round.name, event_date: round.date, status: roundStatus(round),
            results_released: round.settings?.results_released ?? null,
            scored_at: tournament.scored_at || null,
          }, { onConflict: 'league_key,week_number' });
          continue;
        }

        // Upsert the event row with round + tournament links and scoring status.
        const { data: eventData, error: eventError } = await supabase
          .from('igc_league_events')
          .upsert({
            league_key: leagueKey, week_number: weekNumber, gg_event_id: event.id,
            gg_round_id: round.id, gg_tournament_id: tournamentId,
            event_name: round.name, event_date: round.date, status: roundStatus(round),
            results_released: round.settings?.results_released ?? null,
            scored_at: tournament.scored_at || null,
          }, { onConflict: 'league_key,week_number' })
          .select().single();
        if (eventError) {
          console.error(`      Error saving event: ${eventError.message}`);
          continue;
        }

        // Process player results, grouped by scope (each scope is a flight).
        let upserted = 0;
        let firstError = null;
        for (const scope of results.event.scopes) {
          const flightName = scope.name?.trim() || 'Overall';
          for (const aggregate of (scope.aggregates || [])) {
            if (!aggregate.name) continue;
            const memberCardId = aggregate.member_cards?.[0]?.member_card_id_str || null;
            if (memberCardId) {
              mergeMember(memberCardId, { name: aggregate.name });
            }
            const netScores = aggregate.net_scores || [];
            const grossScores = aggregate.gross_scores || [];
            const toParNet = aggregate.to_par_net || [];
            const toParGross = aggregate.to_par_gross || [];
            const totals = aggregate.totals || {};

            // Secondary birdie/double counts (still stored, not the primary view).
            let doubleBogeys = 0, birdies = 0;
            if (parData.length > 0) {
              for (let i = 0; i < netScores.length && i < parData.length; i++) {
                if (netScores[i] !== null && parData[i] !== null) {
                  if (netScores[i] >= parData[i] + 2) doubleBogeys++;
                  if (netScores[i] === parData[i] - 1) birdies++;
                }
              }
            }

            const parsedPosition = parsePosition(aggregate.position);
            const { error: perfError } = await supabase
              .from('igc_league_performances')
              .upsert({
                league_key: leagueKey, week_number: weekNumber, event_id: eventData.id,
                player_name: aggregate.name, member_card_id: memberCardId,
                flight_name: flightName,
                position_label: aggregate.position ? String(aggregate.position) : null,
                flight_position: parsedPosition,
                points: parseNum(aggregate.points),
                gross_scores: grossScores, to_par_net: toParNet, to_par_gross: toParGross,
                net_total: parseIntOrNull(totalOut(totals, 'net_scores')),
                gross_total: parseIntOrNull(totalOut(totals, 'gross_scores')),
                to_par_net_total: parseIntOrNull(totalOut(totals, 'to_par_net')),
                to_par_gross_total: parseIntOrNull(totalOut(totals, 'to_par_gross')),
                purse: aggregate.purse || null,
                holes_completed: countCompletedHoles(grossScores.length ? grossScores : netScores),
                scorecard_status: aggregate.scorecard_statuses?.[0]?.status || null,
                event_name: round.name, event_date: round.date,
                double_bogeys: doubleBogeys, birdies: birdies,
                // weekly_position (legacy, NOT NULL): parsed position; unplaced
                // players get a large sentinel so they sort last, never atop a
                // flight. 0 is avoided so unplaced ≠ a real "1st".
                weekly_position: parsedPosition ?? 9999,
                net_scores: netScores,
              }, { onConflict: 'league_key,week_number,player_name' });

            if (perfError) { if (!firstError) firstError = perfError; } else { upserted++; }
          }
        }
        if (firstError) {
          console.error(`      Upsert error for ${round.name}: ${firstError.message} (upserted ${upserted})`);
        }
        console.log(`      Synced ${round.name} (${upserted} players)`);

        // Capture cumulative season points embedded in this round's results.
        // Each completed individual-points round's payload contains season_points
        // AS OF that round; the latest such round = current standings and the
        // one before = previous standings (authoritative rank movement). Only
        // capture NON-EMPTY season_points — scramble/team weeks (and the women's
        // league, which has no points system) return an empty array and would
        // otherwise blank out the snapshot.
        if (isCompleted && Array.isArray(results.event.season_points) && results.event.season_points.length > 0) {
          prevSeasonPoints = lastSeasonPoints;
          lastSeasonPoints = results.event.season_points;
        }
      } catch (error) {
        console.error(`      Error processing round: ${error.message}`);
      }
    }
  }

  // Remove stale performances from team/side weeks (e.g. scrambles) that a
  // previous run stored before tournament selection excluded them. Such
  // weeks now record a schedule row with no gg_tournament_id and no individual
  // performances, so any leftover rows for those events are stale and would
  // pollute events_played/wins. Done before the snapshot so stats are clean.
  const { data: teamEvents } = await supabase.from('igc_league_events')
    .select('id').eq('league_key', leagueKey).is('gg_tournament_id', null);
  if (teamEvents && teamEvents.length > 0) {
    const teamEventIds = teamEvents.map((e) => e.id);
    const { error: delErr } = await supabase.from('igc_league_performances')
      .delete().in('event_id', teamEventIds);
    console.log(`  Cleaned stale team-week performances: ${teamEventIds.length} event(s)${delErr ? ' (err: ' + delErr.message + ')' : ''}`);
  }

  // Persist the member-card cache (roster + every player who appeared in a
  // round), so season_points member_card_id values can be resolved to names
  // even outside the sync run.
  if (memberInfo.size > 0) {
    const now = new Date().toISOString();
    const rows = [...memberInfo.entries()].map(([id, info]) => ({
      league_key: leagueKey, member_card_id: id, name: info.name,
      email: info.email, handicap_index: info.handicapIndex, synced_at: now,
    }));
    const { error: memberError } = await supabase.from('igc_league_members')
      .upsert(rows, { onConflict: 'league_key,member_card_id' });
    console.log(`  Members cache: ${rows.length} (${memberError ? 'error: ' + memberError.message : 'ok'})`);
  }

  // Build the season-points snapshot from the latest non-empty season_points.
  // GG's `position` here is the player's finishing position in THAT ROUND (per
  // flight), NOT their season rank, so the cumulative rank must be DERIVED by
  // ranking `total_points` (descending, ties share the lower rank). The prior
  // round's season_points is ranked the same way for previous_position (true
  // rank movement). events_played counts weeks the member actually scored;
  // wins counts weeks they finished 1st (parsed position === 1).
  if (lastSeasonPoints && lastSeasonPoints.length > 0) {
    console.log(`  Building season-points snapshot (${lastSeasonPoints.length} entries)...`);

    // events_played (weeks with a recorded score) + wins (parsed position 1)
    // per member_card_id, from the stored weekly performances.
    const { data: perfs } = await supabase
      .from('igc_league_performances')
      .select('member_card_id, week_number, flight_position, gross_scores')
      .eq('league_key', leagueKey)
      .limit(100000);
    const stats = new Map(); // member_card_id -> { events: Set, wins: number }
    for (const p of perfs || []) {
      if (!p.member_card_id) continue;
      if (!stats.has(p.member_card_id)) stats.set(p.member_card_id, { events: new Set(), wins: 0 });
      const s = stats.get(p.member_card_id);
      const scored = Array.isArray(p.gross_scores) && p.gross_scores.some((x) => x !== null && x !== undefined);
      if (scored) s.events.add(p.week_number);
      if (p.flight_position === 1) s.wins += 1;
    }

    const leaderTotal = Math.max(...lastSeasonPoints.map((s) => Number(s.total_points) || 0));
    const currentRankById = rankByTotalPoints(lastSeasonPoints);
    const prevRankById = prevSeasonPoints && prevSeasonPoints.length > 0
      ? rankByTotalPoints(prevSeasonPoints) : new Map();

    let snapshotUpserted = 0;
    for (const sp of lastSeasonPoints) {
      const memberCardId = sp.member_card_id;
      const info = memberInfo.get(memberCardId);
      const playerName = info?.name || null;
      const s = stats.get(memberCardId);
      const pointsBehind = (Number(sp.total_points) || 0) > 0
        ? Math.max(0, leaderTotal - Number(sp.total_points))
        : null;
      const { error } = await supabase.from('igc_league_season_points').upsert({
        league_key: leagueKey, member_card_id: memberCardId, player_name: playerName,
        position: currentRankById.get(memberCardId) ?? null,
        previous_position: prevRankById.get(memberCardId) ?? null,
        total_points: sp.total_points,
        events_played: s?.events.size ?? 0, wins: s?.wins ?? 0,
        points_behind: pointsBehind, synced_at: new Date().toISOString(),
      }, { onConflict: 'league_key,member_card_id' });
      if (error) console.error(`      season_points upsert error ${memberCardId}: ${error.message}`);
      else snapshotUpserted++;
    }
    console.log(`  Snapshot upserted: ${snapshotUpserted}`);
  } else {
    console.log('  No season_points captured (no completed individual-points rounds with season_points).');
  }

  console.log(`\n${config.name} sync complete!`);
}

syncLeague().catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});