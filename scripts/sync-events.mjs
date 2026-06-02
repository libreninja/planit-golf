import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { createClient } from "@supabase/supabase-js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.join(__dirname, "..")

const GIDIOT_DIR = "/Users/jbizzle/dev/gidiot"
const GIDIOT_ENV_PATH = path.join(GIDIOT_DIR, ".env")
const GIDIOT_EVENTS_PATH = path.join(GIDIOT_DIR, "dist/tools/events.js")
const ROUNDS_JSON_PATH = "/Users/jbizzle/projects/while-supplies-last/src/data/rounds.json"
const LOCAL_ENV_PATH = path.join(REPO_ROOT, ".env.local")

const LEAGUE_EVENT_PATTERNS = {
  mens: /IGC Mens League 2026/i,
  womens: /IGC Women's League 2026/i,
}

const COURSE_NAME = "Interbay Golf Center"

// Static time slots - same for every week
const STATIC_TIME_SLOTS = [
  "8:30 AM", "8:37 AM", "8:45 AM", "8:52 AM",
  "9:00 AM", "9:07 AM", "9:15 AM", "9:22 AM", "9:30 AM",
  "2:00 PM", "2:07 PM", "2:15 PM", "2:22 PM", "2:30 PM", "2:37 PM", "2:45 PM",
  "3:00 PM", "3:07 PM", "3:15 PM", "3:22 PM", "3:30 PM", "3:37 PM", "3:45 PM",
  "4:00 PM", "4:07 PM", "4:15 PM", "4:22 PM", "4:30 PM", "4:37 PM", "4:45 PM",
  "5:00 PM", "5:07 PM", "5:15 PM", "5:22 PM", "5:30 PM", "5:37 PM", "5:45 PM",
  "6:00 PM", "6:07 PM", "6:15 PM"
]

async function loadEnvFile(filePath) {
  try {
    const contents = await fs.readFile(filePath, "utf8")
    for (const rawLine of contents.split("\n")) {
      const line = rawLine.trim()
      if (!line || line.startsWith("#")) continue
      const separatorIndex = line.indexOf("=")
      if (separatorIndex === -1) continue
      const key = line.slice(0, separatorIndex).trim()
      const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "")
      if (!process.env[key]) {
        process.env[key] = value
      }
    }
  } catch {
    // Ignore missing env files.
  }
}

async function loadJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"))
}

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
  }

  return createClient(supabaseUrl, serviceRoleKey)
}

function getToday() {
  return new Date().toISOString().slice(0, 10)
}

async function fetchLeagueEvents() {
  await loadEnvFile(GIDIOT_ENV_PATH)
  const { getEvents } = await import(GIDIOT_EVENTS_PATH)

  const eventsResponse = await getEvents({ page: 1 })
  const events = (Array.isArray(eventsResponse) ? eventsResponse : eventsResponse?.events || [])
    .map((row) => row.event || row)
    .filter(Boolean)

  const result = {}
  for (const [league, pattern] of Object.entries(LEAGUE_EVENT_PATTERNS)) {
    const event = events.find((candidate) => pattern.test(candidate.name || ""))
    if (!event) {
      throw new Error(`Could not find Golf Genius event for ${league}`)
    }

    result[league] = event
  }

  return result
}

async function upsertEvent(supabase, eventPayload, timeSlots, { dryRun }) {
  if (dryRun) {
    return {
      eventId: `dry-run-${eventPayload.golf_round_id}`,
      slotCount: timeSlots.length,
    }
  }

  const { data: upsertedEvents, error: eventError } = await supabase
    .from("events")
    .upsert(eventPayload, { onConflict: "event_date" })
    .select("id")
    .limit(1)

  if (eventError) throw eventError

  const eventId = upsertedEvents?.[0]?.id
  if (!eventId) {
    throw new Error(`Failed to resolve event id for round ${eventPayload.golf_round_id}`)
  }

  const { error: deleteError } = await supabase
    .from("event_time_slots")
    .delete()
    .eq("event_id", eventId)

  if (deleteError) throw deleteError

  if (timeSlots.length > 0) {
    const slotPayload = timeSlots.map((timeSlot, index) => ({
      event_id: eventId,
      time_slot: timeSlot,
      display_order: index,
    }))

    const { error: slotError } = await supabase
      .from("event_time_slots")
      .insert(slotPayload)

    if (slotError) throw slotError
  }

  return {
    eventId,
    slotCount: timeSlots.length,
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run")

  await loadEnvFile(LOCAL_ENV_PATH)

  const roundsJson = await loadJson(ROUNDS_JSON_PATH)
  const leagueEvents = await fetchLeagueEvents()
  const supabase = getSupabaseClient()
  const today = getToday()

  const futureRounds = Object.entries(roundsJson)
    .flatMap(([league, rounds]) =>
      Object.entries(rounds || {})
        .filter(([eventDate]) => eventDate >= today)
        .map(([eventDate, round]) => ({
          league,
          eventDate,
          roundId: round.id,
          golfEventId: leagueEvents[league].id || leagueEvents[league].event_id,
        }))
    )
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate))

  const summary = []

  for (const round of futureRounds) {
    const result = await upsertEvent(
      supabase,
      {
        event_date: round.eventDate,
        course_name: COURSE_NAME,
        registration_opens_at: null,
        status: "upcoming",
        league: round.league,
        golf_event_id: round.golfEventId,
        golf_round_id: round.roundId,
      },
      STATIC_TIME_SLOTS,
      { dryRun }
    )

    summary.push({
      league: round.league,
      eventDate: round.eventDate,
      roundId: round.roundId,
      slotCount: result.slotCount,
    })
  }

  console.log(`Synced future events: ${summary.length}`)
  for (const row of summary.slice(0, 12)) {
    console.log(`- ${row.eventDate} [${row.league}] round ${row.roundId}: ${row.slotCount} slots`)
  }
  if (summary.length > 12) {
    console.log(`... ${summary.length - 12} more`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
