// IGC Weekly League Report Generator
// Combines Golf Genius data for leaderboard and blog content

import { getEvents, getEventRounds, GGEventWrapper, GGRoundWrapper } from "./events";
import { getRoundTournaments, getTournamentResults, GGTournament } from "./tournaments";
import { getEventCourses, GGCoursesResponse } from "./courses";

export interface WeeklyPerformance {
  player_name: string;
  member_card_id?: string;
  week_number: number;
  event_name: string;
  event_date?: string;
  double_bogeys: number;
  weekly_position: number;
  ranking_change?: number; // positive = improved
  birdies?: number;
  pars?: number;
  net_scores?: (number | null)[];
}

export interface WeeklyReport {
  season_name: string;
  events_processed: number;
  total_performances: number;
  performances: WeeklyPerformance[];
  // Derived stats for blog content
  storylines: Storyline[];
  paceOfPlay: PaceNote[];
}

export interface Storyline {
  type: "big_mover" | "leader_change" | "weekly_winner" | "consistent_performer";
  player_name: string;
  description: string;
  week: number;
}

export interface PaceNote {
  week: number;
  avg_time?: number;
  note: string;
}

export async function generateWeeklyLeagueReport(params: {
  season_id?: string;
  category_id?: string;
  event_name_filter?: string; // e.g., "Tuesday" for Men's league
  season_points_category_id?: string;
}): Promise<WeeklyReport> {
  // Get all events for the season/category
  const eventsResponse = await getEvents({
    season_id: params.season_id,
    category_id: params.category_id,
  });

  if (!eventsResponse?.length) {
    return {
      season_name: "Unknown",
      events_processed: 0,
      total_performances: 0,
      performances: [],
      storylines: [],
      paceOfPlay: [],
    };
  }

  // Filter and sort events
  let events = eventsResponse;
  if (params.event_name_filter) {
    const filter = params.event_name_filter.toLowerCase();
    events = events.filter((e) => e.event.name.toLowerCase().includes(filter));
  }

  events.sort((a, b) => {
    const dateA = a.event.start_date || a.event.date || "";
    const dateB = b.event.start_date || b.event.date || "";
    return new Date(dateA).getTime() - new Date(dateB).getTime();
  });

  const allPerformances: WeeklyPerformance[] = [];
  const playerLastRankings = new Map<string, { position: number; week: number }>();
  const storylines: Storyline[] = [];

  // Process each event
  for (let weekIndex = 0; weekIndex < events.length; weekIndex++) {
    const eventData = events[weekIndex].event;

    try {
      // Get rounds for this event
      const roundsResponse = await getEventRounds({ event_id: eventData.id });
      if (!roundsResponse?.length) continue;

      // Get courses for par data
      let parData: number[] = [];
      try {
        const coursesData: GGCoursesResponse = await getEventCourses({ event_id: eventData.id });
        if (coursesData.courses?.[0]?.tees?.[0]?.hole_data?.par) {
          parData = coursesData.courses[0].tees[0].hole_data.par;
        }
      } catch {
        // Par data not critical
      }

      // Filter to points rounds only (exclude preseason, fun weeks, etc.)
      const pointsRounds = roundsResponse.filter((r: GGRoundWrapper) => {
        const name = r.round.name.toLowerCase();
        return (
          !name.includes("preseason") &&
          !name.includes("fun week") &&
          !name.includes("horse race") &&
          !name.includes("no points") &&
          name.includes("points")
        );
      });

      // Process each points round
      for (const roundData of pointsRounds) {
        const round = roundData.round;

        // Get tournaments
        const tournamentsResponse = await getRoundTournaments({
          event_id: eventData.id,
          round_id: round.id,
        });
        if (!tournamentsResponse?.length) continue;

        // Find the main individual tournament (not team events)
        const individualTournament = tournamentsResponse.find((t) => {
          const name = t.event.name.toLowerCase();
          return !name.includes("team") && !name.includes("cup");
        });

        if (!individualTournament) continue;

        // Get results
        const results = await getTournamentResults({
          event_id: eventData.id,
          round_id: round.id,
          tournament_id: individualTournament.event.id,
          format: "json",
        });

        if (!results.event?.scopes) continue;

        // Process each player's results
        let weekWinner: { name: string; position: number } | null = null;

        for (const scope of results.event.scopes) {
          if (!scope.aggregates) continue;

          for (const aggregate of scope.aggregates) {
            const netScores = aggregate.net_scores || [];
            const memberCardIds = aggregate.member_card_ids || [];
            const position = parseInt(aggregate.position) || 0;
            const playerName = aggregate.name;

            // Calculate stats
            let doubleBogeyCount = 0;
            let birdieCount = 0;

            if (parData.length > 0) {
              for (let i = 0; i < netScores.length && i < parData.length; i++) {
                const netScore = netScores[i];
                const par = parData[i];
                if (netScore !== null && par !== null) {
                  if (netScore >= par + 2) doubleBogeyCount++;
                  if (netScore === par - 1) birdieCount++;
                }
              }
            }

            const memberCardId = memberCardIds[0]?.member_card_id_str;
            const playerKey = memberCardId || playerName;

            // Calculate ranking change
            let rankingChange: number | undefined;
            const lastRanking = playerLastRankings.get(playerKey);
            if (lastRanking) {
              rankingChange = lastRanking.position - position;
            }

            // Track week winner
            if (position === 1 && !weekWinner) {
              weekWinner = { name: playerName, position };
            }

            // Big mover detection (moved 10+ spots)
            if (rankingChange && rankingChange >= 10) {
              storylines.push({
                type: "big_mover",
                player_name: playerName,
                description: `${playerName} moved up ${rankingChange} spots to ${position}th place`,
                week: weekIndex + 1,
              });
            }

            allPerformances.push({
              player_name: playerName,
              member_card_id: memberCardId,
              week_number: weekIndex + 1,
              event_name: eventData.name,
              event_date: eventData.start_date || eventData.date || round.date,
              double_bogeys: doubleBogeyCount,
              birdies: birdieCount,
              weekly_position: position,
              ranking_change: rankingChange,
              net_scores: netScores,
            });

            // Update last ranking
            playerLastRankings.set(playerKey, { position, week: weekIndex + 1 });
          }
        }

        // Add week winner storyline
        if (weekWinner) {
          storylines.push({
            type: "weekly_winner",
            player_name: weekWinner.name,
            description: `${weekWinner.name} won week ${weekIndex + 1}`,
            week: weekIndex + 1,
          });
        }
      }
    } catch (error) {
      console.error(`Error processing event ${eventData.name}:`, error);
      continue;
    }
  }

  // Sort performances by name then week
  allPerformances.sort((a, b) => {
    const nameCompare = a.player_name.localeCompare(b.player_name);
    if (nameCompare !== 0) return nameCompare;
    return a.week_number - b.week_number;
  });

  // Generate pace notes (placeholder - could be populated from pace timing data)
  const paceOfPlay: PaceNote[] = events.map((e, i) => ({
    week: i + 1,
    note: "Remember to play ready golf!",
  }));

  return {
    season_name: events[0]?.event.name.split("-")[0]?.trim() || "IGC League",
    events_processed: events.length,
    total_performances: allPerformances.length,
    performances: allPerformances,
    storylines,
    paceOfPlay,
  };
}

// Generate blog content from report
export function generateBlogPost(report: WeeklyReport, weekNumber: number): string {
  const weekPerformances = report.performances.filter((p) => p.week_number === weekNumber);
  const weekStorylines = report.storylines.filter((s) => s.week === weekNumber);

  let blog = `# ${report.season_name} - Week ${weekNumber} Recap\n\n`;

  // Storylines
  if (weekStorylines.length > 0) {
    blog += "## This Week's Highlights\n\n";
    for (const story of weekStorylines) {
      blog += `- ${story.description}\n`;
    }
    blog += "\n";
  }

  // Top performers
  const top3 = weekPerformances.slice().sort((a, b) => a.weekly_position - b.weekly_position).slice(0, 3);
  if (top3.length > 0) {
    blog += "## Top Finishers\n\n";
    top3.forEach((p, i) => {
      blog += `${i + 1}. ${p.player_name}\n`;
    });
    blog += "\n";
  }

  // Reminders
  const paceNote = report.paceOfPlay.find((p) => p.week === weekNumber);
  if (paceNote) {
    blog += `## Reminders\n\n${paceNote.note}\n`;
  }

  return blog;
}
