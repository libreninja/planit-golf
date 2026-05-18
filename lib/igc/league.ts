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
}

export interface IGCLeaderboardEntry {
  rank: number;
  player_name: string;
  total_points: number;
  events_played: number;
  trend?: "up" | "down" | "stable";
  last_week_position?: number;
}

export interface IGCWeeklyResult {
  week: number;
  player_name: string;
  position: number;
  points_earned?: number;
  double_bogeys: number;
  birdies: number;
}

// League configurations
export const IGC_LEAGUES: Record<string, IGCLeagueConfig> = {
  mens_tuesday: {
    seasonId: process.env.IGC_MENS_SEASON_ID || "",
    categoryId: process.env.IGC_MENS_CATEGORY_ID || "",
    seasonPointsCategoryId: process.env.IGC_MENS_POINTS_CATEGORY_ID || "",
    name: "Men's Tuesday League",
  },
  womens_wednesday: {
    seasonId: process.env.IGC_WOMENS_SEASON_ID || "",
    categoryId: process.env.IGC_WOMENS_CATEGORY_ID || "",
    seasonPointsCategoryId: process.env.IGC_WOMENS_POINTS_CATEGORY_ID || "",
    name: "Women's Wednesday League",
  },
};

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
    event_name_filter: config.name.includes("Tuesday") ? "Tuesday" : "Wednesday",
    season_points_category_id: config.seasonPointsCategoryId,
  });

  // Store in database for caching
  const serviceClient = createServiceClient();

  // Upsert weekly performances
  for (const perf of report.performances) {
    await serviceClient.from("igc_league_performances").upsert(
      {
        league_key: leagueKey,
        week_number: perf.week_number,
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

  const { data, error } = await query.order("week_number", {
    ascending: false,
  });

  if (error) throw error;

  return (
    data?.map((p) => ({
      week: p.week_number,
      player_name: p.player_name,
      position: p.weekly_position,
      double_bogeys: p.double_bogeys || 0,
      birdies: p.birdies || 0,
    })) || []
  );
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
