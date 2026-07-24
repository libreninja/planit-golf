#!/usr/bin/env node
// Sync IGC league data from Golf Genius to local database
// Usage: node scripts/sync-igc-league.mjs [mens|womens]

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

// League configurations
const LEAGUES = {
  mens: {
    seasonId: process.env.IGC_MENS_SEASON_ID,
    categoryId: process.env.IGC_MENS_CATEGORY_ID,
    pointsCategoryId: process.env.IGC_MENS_POINTS_CATEGORY_ID,
    name: "Men's League",
    hasFlights: true,
  },
  womens: {
    seasonId: process.env.IGC_WOMENS_SEASON_ID,
    categoryId: process.env.IGC_WOMENS_CATEGORY_ID,
    pointsCategoryId: process.env.IGC_WOMENS_POINTS_CATEGORY_ID,
    name: "Women's League",
    hasFlights: false,
  },
};

const config = LEAGUES[leagueKey];
if (!config.seasonId || !config.categoryId) {
  console.error(`Missing env vars for ${leagueKey} league: IGC_${leagueKey.toUpperCase()}_SEASON_ID and IGC_${leagueKey.toUpperCase()}_CATEGORY_ID required`);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false }
});

// GG API client
async function ggRequest(endpoint, queryParams = {}) {
  const params = new URLSearchParams();
  Object.entries(queryParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  });

  const queryString = params.toString();
  const url = `${BASE_URL}/api_v2/${API_KEY}${endpoint}${queryString ? '?' + queryString : ''}`;

  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GG API error (${response.status}): ${errorText.slice(0, 200)}`);
  }

  return response.json();
}

async function syncLeague() {
  console.log(`Syncing ${config.name}...`);

  // Get events for the season/category
  console.log('  Fetching events...');
  const eventsResponse = await ggRequest('/events', {
    season_id: config.seasonId,
    category_id: config.categoryId,
  });

  if (!Array.isArray(eventsResponse) || eventsResponse.length === 0) {
    console.log('  No events found');
    return;
  }

  // Filter and sort events - look for the Men's/Women's league season event.
  // GG names them "IGC Mens League 2026" and "IGC Women's League 2026"; note
  // the apostrophe in "Women's", so the filter for women's is "women" (a
  // substring of "women's"), while men's uses "mens" (which is NOT a substring
  // of "women's", so the two leagues never cross-match).
  const leagueFilter = leagueKey === 'mens' ? 'mens' : 'women';
  const events = eventsResponse
    .filter(e => e.event?.name?.toLowerCase().includes(leagueFilter))
    .sort((a, b) => {
      const dateA = new Date(a.event.start_date || a.event.date || 0);
      const dateB = new Date(b.event.start_date || b.event.date || 0);
      return dateA.getTime() - dateB.getTime();
    });

  console.log(`  Found ${events.length} events`);

  // Process each event (GG structure: 1 event per league season with multiple rounds)
  for (const eventWrapper of events) {
    const event = eventWrapper.event;

    console.log(`  Processing event: ${event.name}`);

    // Get rounds for this event
    const roundsResponse = await ggRequest(`/events/${event.id}/rounds`);
    if (!Array.isArray(roundsResponse) || roundsResponse.length === 0) {
      console.log(`    No rounds found`);
      continue;
    }

    // Filter to regular-season points rounds. GG API returns rounds wrapped in
    // {round: {...}}. The two leagues NAME their points rounds differently:
    //   - Men's: "Points Season - Week N"
    //   - Women's: "Regular Season Week N"
    // The old filter required the round name to include the literal "points",
    // which kept the men's rounds but silently dropped ALL women's rounds
    // ("Regular Season" has no "points" substring). So filter purely by
    // EXCLUSION of known non-points rounds instead — this admits both naming
    // conventions and keeps the league's own round order authoritative.
    const NON_POINTS = [
      'preseason',
      'post season',
      'postseason',
      'club championship',
      'fun week',
      'horse race',
      'no points',
    ]
    const pointsRounds = roundsResponse.filter(r => {
      const name = r.round?.name?.toLowerCase() || '';
      return !NON_POINTS.some(needle => name.includes(needle));
    }).map(r => r.round);

    // Sort by round index to ensure correct week order
    pointsRounds.sort((a, b) => (a.index || 0) - (b.index || 0));

    // Get courses for par data
    let parData = [];
    try {
      const coursesData = await ggRequest(`/events/${event.id}/courses`);
      if (coursesData?.courses?.[0]?.tees?.[0]?.hole_data?.par) {
        parData = coursesData.courses[0].tees[0].hole_data.par;
      }
    } catch {
      // Par data not critical
    }

    // Process each points round as its own week
    let weekNumber = 0;
    for (const round of pointsRounds) {
      weekNumber++;
      console.log(`    Processing week ${weekNumber}: ${round.name}`);

      try {
        // Upsert event for this week
        const { data: eventData, error: eventError } = await supabase
          .from('igc_league_events')
          .upsert({
            league_key: leagueKey,
            week_number: weekNumber,
            gg_event_id: event.id,
            event_name: round.name,
            event_date: round.date,
            status: round.status === 'completed' ? 'finalized' : 'upcoming',
          }, { onConflict: 'league_key,week_number' })
          .select()
          .single();

        if (eventError) {
          console.error(`      Error saving event: ${eventError.message}`);
          continue;
        }
        // Get tournaments for this round
        const tournamentsResponse = await ggRequest(`/events/${event.id}/rounds/${round.id}/tournaments`);
        if (!Array.isArray(tournamentsResponse) || tournamentsResponse.length === 0) continue;

        // Find individual tournament (not team) - tournaments wrapped in {event: {...}}
        const individualTournament = tournamentsResponse.find(t => {
          const name = t.event?.name?.toLowerCase() || '';
          return !name.includes('team') && !name.includes('cup');
        });

        if (!individualTournament) continue;

        const tournamentId = individualTournament.event?.id;
        if (!tournamentId) continue;

        // Fetch results (GG API uses .json suffix, not /results). GG sometimes
        // returns the tournament scope with an EMPTY aggregates array on rapid
        // sequential calls (throttling), even for a completed round that
        // genuinely has results. For a completed round that is a real data loss
        // (an entire week's standings silently missing), so retry a few times
        // with a short pause before accepting an empty result. Upcoming rounds
        // legitimately have no aggregates yet, so they don't retry.
        const resultsUrl = `/events/${event.id}/rounds/${round.id}/tournaments/${tournamentId}.json`;
        const isCompleted = round.status === 'completed';
        let aggregates = [];
        for (let attempt = 1; attempt <= 4; attempt++) {
          const results = await ggRequest(resultsUrl);
          const scoped = (results?.event?.scopes || []).flatMap((s) => s.aggregates || []);
          aggregates = scoped.filter((a) => a && a.name);
          if (aggregates.length > 0) break;
          if (!isCompleted) break;
          if (attempt < 4) await new Promise((r) => setTimeout(r, 750 * attempt));
        }

        if (aggregates.length === 0) {
          console.log(`      No aggregates${isCompleted ? ' after retries' : ''} for ${round.name}`);
          continue;
        }

        // Process player results
        let upserted = 0;
        let firstError = null;
        for (const aggregate of aggregates) {
          const netScores = aggregate.net_scores || [];
          // Extract member_card_id from member_cards array
          const memberCardId = aggregate.member_cards?.[0]?.member_card_id_str;
          // Use rank field for position (position field is like "--" or "T1")
          const position = parseInt(aggregate.rank) || 0;

          // Calculate stats
          let doubleBogeys = 0;
          let birdies = 0;

          if (parData.length > 0) {
            for (let i = 0; i < netScores.length && i < parData.length; i++) {
              const netScore = netScores[i];
              const par = parData[i];
              if (netScore !== null && par !== null) {
                if (netScore >= par + 2) doubleBogeys++;
                if (netScore === par - 1) birdies++;
              }
            }
          }

          // Upsert performance. Check the error — a silent upsert failure here
          // means a whole week's results vanish from the standings with no
          // signal, so surface the first error rather than swallowing it.
          const { error: perfError } = await supabase
            .from('igc_league_performances')
            .upsert({
              league_key: leagueKey,
              week_number: weekNumber,
              event_id: eventData.id,
              player_name: aggregate.name,
              member_card_id: memberCardId,
              event_name: round.name,
              event_date: round.date,
              double_bogeys: doubleBogeys,
              birdies: birdies,
              weekly_position: position,
              net_scores: netScores,
            }, { onConflict: 'league_key,week_number,player_name' });

          if (perfError) {
            if (!firstError) firstError = perfError;
          } else {
            upserted++;
          }
        }

        if (firstError) {
          console.error(`      Upsert error for ${round.name}: ${firstError.message} (upserted ${upserted}/${aggregates.length})`);
        }

        console.log(`      Synced ${round.name} (${upserted} players)`);
      } catch (error) {
        console.error(`      Error processing round: ${error.message}`);
      }
    }
  }

  console.log(`\n${config.name} sync complete!`);
}

syncLeague().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
