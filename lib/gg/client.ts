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

export async function makeGolfGeniusRequest<T = unknown>({
  endpoint,
  method = "GET",
  body,
  queryParams = {},
}: {
  endpoint: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  queryParams?: Record<string, unknown>;
}): Promise<T> {
  if (!API_KEY) {
    throw new Error("GOLF_GENIUS_API_KEY environment variable is required");
  }

  const queryString = buildQueryString(queryParams);
  const url = `${BASE_URL}/api_v2/${API_KEY}${endpoint}${queryString}`;

  try {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });

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
