// IGC League data layer
// Combines Golf Genius data with local storage for live leaderboards

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  getSeasonPointsStandings,
  getSeasonPointsCategories,
  generateWeeklyLeagueReport,
  type WeeklyReport,
  type SeasonPointsStanding,
} from "@/lib/gg";

export interface IGCLeagueConfig {
  seasonId: string;
  categoryId: string; // Men's or Women's league
  seasonPointsCategoryId: string;
  name: string;
  hasFlights: boolean; // Men's league has 3 flights
}

export interface IGCEvent {
  id: string;
  week_number: number;
  event_name: string;
  event_date: string;
  course_name?: string;
  status: 'upcoming' | 'live' | 'finalized';
  flights_finalized: boolean;
}

export interface IGCLeaderboardEntry {
  rank: number;
  flight?: 'A' | 'B' | 'C';
  flight_position?: number;
  player_name: string;
  total_points: number;
  events_played: number;
  trend?: "up" | "down" | "stable";
  last_week_position?: number;
}

export interface IGCWeeklyResult {
  week: number;
  event_date?: string;
  player_name: string;
  position: number;
  flight?: 'A' | 'B' | 'C';
  flight_position?: number;
  points_earned?: number;
  double_bogeys: number;
  birdies: number;
  net_scores?: (number | null)[];
  ranking_change?: number;
}

// League configurations
export const IGC_LEAGUES: Record<string, IGCLeagueConfig> = {
  mens: {
    seasonId: process.env.IGC_MENS_SEASON_ID || "",
    categoryId: process.env.IGC_MENS_CATEGORY_ID || "",
    seasonPointsCategoryId: process.env.IGC_MENS_POINTS_CATEGORY_ID || "",
    name: "Men's League",
    hasFlights: true,
  },
  womens: {
    seasonId: process.env.IGC_WOMENS_SEASON_ID || "",
    categoryId: process.env.IGC_WOMENS_CATEGORY_ID || "",
    seasonPointsCategoryId: process.env.IGC_WOMENS_POINTS_CATEGORY_ID || "",
    name: "Women's League",
    hasFlights: false,
  },
};

// Get all events for a league (for the dropdown selector)
export async function getLeagueEvents(
  leagueKey: string
): Promise<IGCEvent[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("igc_league_events")
    .select("*")
    .eq("league_key", leagueKey)
    .order("event_date", { ascending: false });

  if (error) throw error;

  return (
    data?.map((e) => ({
      id: e.id,
      week_number: e.week_number,
      event_name: e.event_name,
      event_date: e.event_date,
      course_name: e.course_name,
      status: e.status,
      flights_finalized: e.flights_finalized,
    })) || []
  );
}

// Get specific event by week number
export async function getLeagueEvent(
  leagueKey: string,
  weekNumber: number
): Promise<IGCEvent | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("igc_league_events")
    .select("*")
    .eq("league_key", leagueKey)
    .eq("week_number", weekNumber)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    week_number: data.week_number,
    event_name: data.event_name,
    event_date: data.event_date,
    course_name: data.course_name,
    status: data.status,
    flights_finalized: data.flights_finalized,
  };
}

// Get season leaderboard (overall points)
export async function getLeagueLeaderboard(
  leagueKey: string
): Promise<IGCLeaderboardEntry[]> {
  const config = IGC_LEAGUES[leagueKey];
  if (!config) {
    throw new Error(`Unknown league: ${leagueKey}`);
  }

  // Get current standings from GG
  const standings = await getSeasonPointsStandings({
    season_points_category_id: config.seasonPointsCategoryId,
  });

  // Map to leaderboard format
  return standings.map((s) => ({
    rank: s.rank,
    player_name: s.name,
    total_points: s.total_points,
    events_played: s.events_played,
    trend: "stable", // Could calculate from historical data
  }));
}

// Get weekly results with flight support
export async function getLeagueWeeklyResults(
  leagueKey: string,
  weekNumber?: number
): Promise<IGCWeeklyResult[]> {
  const supabase = await createClient();

  let query = supabase
    .from("igc_league_performances")
    .select("*")
    .eq("league_key", leagueKey);

  if (weekNumber) {
    query = query.eq("week_number", weekNumber);
  }

  const { data, error } = await query
    .order("flight", { ascending: true, nullsFirst: false })
    .order("flight_position", { ascending: true })
    .order("weekly_position", { ascending: true });

  if (error) throw error;

  return (
    data?.map((p) => ({
      week: p.week_number,
      event_date: p.event_date,
      player_name: p.player_name,
      position: p.weekly_position,
      flight: p.flight || undefined,
      flight_position: p.flight_position || undefined,
      double_bogeys: p.double_bogeys || 0,
      birdies: p.birdies || 0,
      net_scores: p.net_scores,
    })) || []
  );
}

// Get weekly results grouped by flight (for finalized events)
export async function getLeagueWeeklyResultsByFlight(
  leagueKey: string,
  weekNumber: number
): Promise<Record<string, IGCWeeklyResult[]>> {
  const results = await getLeagueWeeklyResults(leagueKey, weekNumber);

  // Check if flights are assigned
  const hasFlights = results.some((r) => r.flight);

  if (!hasFlights) {
    // Return all results under a single "Overall" key
    return { Overall: results };
  }

  // Group by flight
  const grouped: Record<string, IGCWeeklyResult[]> = {
    A: [],
    B: [],
    C: [],
  };

  for (const result of results) {
    if (result.flight) {
      grouped[result.flight].push(result);
    }
  }

  return grouped;
}

// Sync weekly data from GG
export async function syncLeagueWeeklyReport(
  leagueKey: string
): Promise<WeeklyReport> {
  const config = IGC_LEAGUES[leagueKey];
  if (!config) {
    throw new Error(`Unknown league: ${leagueKey}`);
  }

  const report = await generateWeeklyLeagueReport({
    season_id: config.seasonId,
    category_id: config.categoryId,
    event_name_filter: config.name.includes("Men") ? "mens" : "womens",
    season_points_category_id: config.seasonPointsCategoryId,
  });

  // Store in database for caching
  const serviceClient = createServiceClient();

  // Upsert events first
  for (const perf of report.performances) {
    const { data: eventData } = await serviceClient
      .from("igc_league_events")
      .upsert(
        {
          league_key: leagueKey,
          week_number: perf.week_number,
          event_name: perf.event_name,
          event_date: perf.event_date,
          status: 'finalized', // Assuming sync happens after round completes
          updated_at: new Date().toISOString(),
        },
        { onConflict: "league_key,week_number" }
      )
      .select()
      .single();

    // Upsert weekly performances
    await serviceClient.from("igc_league_performances").upsert(
      {
        league_key: leagueKey,
        week_number: perf.week_number,
        event_id: eventData?.id,
        player_name: perf.player_name,
        member_card_id: perf.member_card_id,
        event_name: perf.event_name,
        event_date: perf.event_date,
        double_bogeys: perf.double_bogeys,
        birdies: perf.birdies,
        weekly_position: perf.weekly_position,
        ranking_change: perf.ranking_change,
        net_scores: perf.net_scores,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "league_key,week_number,player_name",
      }
    );
  }

  return report;
}

// Assign flights after round is finalized (admin only)
export async function assignFlights(
  leagueKey: string,
  weekNumber: number,
  flightAssignments: Record<string, 'A' | 'B' | 'C'>
): Promise<void> {
  const serviceClient = createServiceClient();

  // Update each player with their flight
  for (const [playerName, flight] of Object.entries(flightAssignments)) {
    await serviceClient
      .from("igc_league_performances")
      .update({
        flight,
        updated_at: new Date().toISOString()
      })
      .eq("league_key", leagueKey)
      .eq("week_number", weekNumber)
      .eq("player_name", playerName);
  }

  // Mark event as flights finalized
  await serviceClient
    .from("igc_league_events")
    .update({
      flights_finalized: true,
      finalized_at: new Date().toISOString(),
    })
    .eq("league_key", leagueKey)
    .eq("week_number", weekNumber);
}

export async function getLeagueBlogContent(
  leagueKey: string,
  weekNumber: number
): Promise<string | null> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("igc_league_blog_posts")
    .select("content")
    .eq("league_key", leagueKey)
    .eq("week_number", weekNumber)
    .maybeSingle();

  return data?.content || null;
}

export async function saveLeagueBlogPost(
  leagueKey: string,
  weekNumber: number,
  content: string
): Promise<void> {
  const serviceClient = createServiceClient();

  await serviceClient.from("igc_league_blog_posts").upsert(
    {
      league_key: leagueKey,
      week_number: weekNumber,
      content,
      published: false,
      created_at: new Date().toISOString(),
    },
    {
      onConflict: "league_key,week_number",
    }
  );
}
