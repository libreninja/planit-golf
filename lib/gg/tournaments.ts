// Golf Genius Tournaments API
import { makeGolfGeniusRequest } from "./client";

export interface GGTournament {
  id: string;
  name: string;
  event_type?: string;
}

export interface GGTournamentWrapper {
  event: GGTournament;
}

export interface GGAggregate {
  name: string;
  position: string;
  net_scores?: (number | null)[];
  member_card_ids?: { member_card_id_str: string }[];
}

export interface GGScope {
  aggregates?: GGAggregate[];
}

export interface GGTournamentResults {
  event?: {
    scopes?: GGScope[];
  };
}

export async function getRoundTournaments(params: {
  event_id: string;
  round_id: string;
}): Promise<GGTournamentWrapper[]> {
  return makeGolfGeniusRequest<GGTournamentWrapper[]>({
    endpoint: `/events/${params.event_id}/rounds/${params.round_id}/tournaments`,
  });
}

export async function getTournamentResults(params: {
  event_id: string;
  round_id: string;
  tournament_id: string;
  format?: "json" | "html";
}): Promise<GGTournamentResults> {
  return makeGolfGeniusRequest<GGTournamentResults>({
    endpoint: `/events/${params.event_id}/rounds/${params.round_id}/tournaments/${params.tournament_id}/results`,
    queryParams: { format: params.format || "json" },
  });
}

export interface SeasonPointsCategory {
  id: string;
  name: string;
}

export async function getSeasonPointsCategories(): Promise<
  SeasonPointsCategory[]
> {
  return makeGolfGeniusRequest<SeasonPointsCategory[]>({
    endpoint: "/season_points",
  });
}

export interface SeasonPointsStanding {
  member_card_id: string;
  name: string;
  total_points: number;
  rank: number;
  events_played: number;
}

export async function getSeasonPointsStandings(params: {
  season_points_category_id: string;
}): Promise<SeasonPointsStanding[]> {
  return makeGolfGeniusRequest<SeasonPointsStanding[]>({
    endpoint: `/season_points/${params.season_points_category_id}/standings`,
  });
}
