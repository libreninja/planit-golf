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
    throw new Error(`GG API error (${response.status}): ${errorText}`);
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

  // Filter and sort events
  const leagueDay = leagueKey === 'mens' ? 'Tuesday' : 'Wednesday';
  const events = eventsResponse
    .filter(e => e.event?.name?.toLowerCase().includes(leagueDay.toLowerCase()))
    .sort((a, b) => {
      const dateA = new Date(a.event.start_date || a.event.date || 0);
      const dateB = new Date(b.event.start_date || b.event.date || 0);
      return dateA.getTime() - dateB.getTime();
    });

  console.log(`  Found ${events.length} events`);

  // Process each event
  let weekNumber = 0;
  for (const eventWrapper of events) {
    weekNumber++;
    const event = eventWrapper.event;

    console.log(`  Processing week ${weekNumber}: ${event.name}`);

    try {
      // Upsert event
      const { data: eventData, error: eventError } = await supabase
        .from('igc_league_events')
        .upsert({
          league_key: leagueKey,
          week_number: weekNumber,
          gg_event_id: event.id,
          event_name: event.name,
          event_date: event.start_date || event.date,
          status: 'finalized', // Assuming we're syncing completed events
        }, { onConflict: 'league_key,week_number' })
        .select()
        .single();

      if (eventError) {
        console.error(`    Error saving event: ${eventError.message}`);
        continue;
      }

      // Get rounds for this event
      const roundsResponse = await ggRequest(`/events/${event.id}/rounds`);
      if (!Array.isArray(roundsResponse) || roundsResponse.length === 0) {
        console.log(`    No rounds found`);
        continue;
      }

      // Filter to points rounds
      const pointsRounds = roundsResponse.filter(r => {
        const name = r.round?.name?.toLowerCase() || '';
        return !name.includes('preseason') &&
               !name.includes('fun week') &&
               !name.includes('horse race') &&
               !name.includes('no points') &&
               name.includes('points');
      });

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

      // Process each points round
      for (const roundWrapper of pointsRounds) {
        const round = roundWrapper.round;

        // Get tournaments
        const tournamentsResponse = await ggRequest(`/events/${event.id}/rounds/${round.id}/tournaments`);
        if (!Array.isArray(tournamentsResponse) || tournamentsResponse.length === 0) continue;

        // Find individual tournament (not team)
        const individualTournament = tournamentsResponse.find(t => {
          const name = t.event?.name?.toLowerCase() || '';
          return !name.includes('team') && !name.includes('cup');
        });

        if (!individualTournament) continue;

        // Get results
        const results = await ggRequest(`/events/${event.id}/rounds/${round.id}/tournaments/${individualTournament.event.id}/results`, {
          format: 'json'
        });

        if (!results?.event?.scopes) continue;

        // Process player results
        for (const scope of results.event.scopes) {
          if (!scope.aggregates) continue;

          for (const aggregate of scope.aggregates) {
            const netScores = aggregate.net_scores || [];
            const memberCardIds = aggregate.member_card_ids || [];
            const position = parseInt(aggregate.position) || 0;

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

            // Upsert performance
            await supabase
              .from('igc_league_performances')
              .upsert({
                league_key: leagueKey,
                week_number: weekNumber,
                event_id: eventData.id,
                player_name: aggregate.name,
                member_card_id: memberCardIds[0]?.member_card_id_str,
                event_name: event.name,
                event_date: event.start_date || event.date || round.date,
                double_bogeys: doubleBogeys,
                birdies: birdies,
                weekly_position: position,
                net_scores: netScores,
              }, { onConflict: 'league_key,week_number,player_name' });
          }
        }
      }

      console.log(`    Synced week ${weekNumber}`);
    } catch (error) {
      console.error(`    Error processing event: ${error.message}`);
    }
  }

  console.log(`\n${config.name} sync complete!`);
}

syncLeague().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
