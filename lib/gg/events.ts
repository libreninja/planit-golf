// Golf Genius Events API
import { makeGolfGeniusRequest } from "./client";

export interface GGEvent {
  id: string;
  name: string;
  start_date?: string;
  date?: string;
  status: string;
  season_id?: string;
  category_id?: string;
}

export interface GGEventWrapper {
  event: GGEvent;
}

export interface GGRound {
  id: string;
  name: string;
  date?: string;
  status: string;
}

export interface GGRoundWrapper {
  round: GGRound;
}

export async function getEvents(params: {
  season_id?: string;
  category_id?: string;
}): Promise<GGEventWrapper[]> {
  const queryParams: Record<string, unknown> = {};
  if (params.season_id) queryParams.season_id = params.season_id;
  if (params.category_id) queryParams.category_id = params.category_id;

  return makeGolfGeniusRequest<GGEventWrapper[]>({
    endpoint: "/events",
    queryParams,
  });
}

export async function getEventRounds(params: {
  event_id: string;
}): Promise<GGRoundWrapper[]> {
  return makeGolfGeniusRequest<GGRoundWrapper[]>({
    endpoint: `/events/${params.event_id}/rounds`,
  });
}

export async function getSeasons(): Promise<{ id: string; name: string }[]> {
  return makeGolfGeniusRequest<{ id: string; name: string }[]>({
    endpoint: "/seasons",
  });
}

export async function getCategories(): Promise<{ id: string; name: string }[]> {
  return makeGolfGeniusRequest<{ id: string; name: string }[]>({
    endpoint: "/categories",
  });
}
