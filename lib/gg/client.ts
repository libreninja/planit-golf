// Golf Genius API client
// Adapted from gidiot for planit.golf IGC league integration

const API_KEY = process.env.GOLF_GENIUS_API_KEY;
const BASE_URL = process.env.GOLF_GENIUS_BASE_URL || "https://www.golfgenius.com";

export function buildQueryString(params: Record<string, unknown>): string {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return entries.length > 0 ? `?${entries.join("&")}` : "";
}

interface RequestOptions {
  endpoint: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  queryParams?: Record<string, unknown>;
}

// Shared URL + fetch. Throws on network failure and on missing API key so both
// public variants surface the same upstream-failure behavior; response status
// handling is the caller's job.
async function sendRequest({ endpoint, method = "GET", body, queryParams = {} }: RequestOptions): Promise<Response> {
  if (!API_KEY) {
    throw new Error("GOLF_GENIUS_API_KEY environment variable is required");
  }
  const queryString = buildQueryString(queryParams);
  const url = `${BASE_URL}/api_v2/${API_KEY}${endpoint}${queryString}`;
  return fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Strict variant: any non-OK response (including 404) throws. Used by callers
// that expect a payload and treat a missing resource as a hard error.
export async function makeGolfGeniusRequest<T = unknown>({
  endpoint,
  method = "GET",
  body,
  queryParams = {},
}: RequestOptions): Promise<T> {
  try {
    const response = await sendRequest({ endpoint, method, body, queryParams });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Golf Genius API error (${response.status}): ${errorText}`);
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to fetch from Golf Genius API: ${error.message}`);
    }
    throw error;
  }
}

// 404-tolerant variant: a 404 resolves to null instead of throwing. Used by
// discovery, whose contract (see discovery.ts ERROR CONTRACT) treats 404 as
// "not found yet" (null/[]) — NOT a failure — so a round whose results are not
// posted yet (or a stale hinted id) degrades to not_started / fresh discovery
// instead of surfacing as a reconcile error or blanking the live leaderboard.
// 401/403/5xx and network errors still throw (genuine upstream failure → the
// caller's stale-while-error handler serves last-known data).
export async function makeGolfGeniusRequestOptional<T = unknown>({
  endpoint,
  method = "GET",
  body,
  queryParams = {},
}: RequestOptions): Promise<T | null> {
  try {
    const response = await sendRequest({ endpoint, method, body, queryParams });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Golf Genius API error (${response.status}): ${errorText}`);
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to fetch from Golf Genius API: ${error.message}`);
    }
    throw error;
  }
}