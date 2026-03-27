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
const GIDIOT_TEE_SHEETS_PATH = path.join(GIDIOT_DIR, "dist/tools/teeSheets.js")
const ROUNDS_JSON_PATH = "/Users/jbizzle/projects/while-supplies-last/src/data/rounds.json"
const GOLF_GENIUS_CONFIG_PATH = "/Users/jbizzle/projects/while-supplies-last/config/default.json"
const LOCAL_ENV_PATH = path.join(REPO_ROOT, ".env.local")

const LEAGUE_EVENT_PATTERNS = {
  mens: /IGC Mens League 2026/i,
  womens: /IGC Women's League 2026/i,
}

const COURSE_NAME = "Interbay Golf Center"

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

function normalizeTime(value) {
  return value.trim().replace(/\s+/g, " ")
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

async function fetchRoundTimeSlots({ eventId, roundId }) {
  const { getTeeSheet } = await import(GIDIOT_TEE_SHEETS_PATH)
  const teeSheetResponse = await getTeeSheet({ event_id: eventId, round_id: roundId })
  const rows = Array.isArray(teeSheetResponse) ? teeSheetResponse : []

  return Array.from(
    new Set(
      rows
        .map((row) => row.pairing_group?.tee_time || row.tee_time || null)
        .filter(Boolean)
        .map(normalizeTime)
    )
  )
}

async function fetchReservationPageSlotsByLeague(golfGeniusConfig) {
  const slotsByLeague = new Map()

  for (const [league, config] of Object.entries(golfGeniusConfig?.golfGenius?.leagues || {})) {
    const url = `https://${config.baseUrl}/leagues/${config.leagueId}/widgets/players_choose_tee_times/login?page_id=${config.pageId}&shared=false`

    try {
      const response = await fetch(url, {
        headers: config.headers || {},
      })
      const html = await response.text()
      const slots = Array.from(
        new Set(
          Array.from(html.matchAll(/<td[^>]*class=['"][^'"]*\btee-at\b[^'"]*['"][^>]*>(.*?)<\/td>/gsi))
            .map((match) => normalizeTime(match[1].replace(/<[^>]+>/g, " ")))
            .filter(Boolean)
        )
      )

      if (slots.length > 0) {
        slotsByLeague.set(league, slots)
      }
    } catch {
      // Fall back to tee sheet-derived canonical slots for this league.
    }
  }

  return slotsByLeague
}

function chooseCanonicalSlotsByLeague(rounds, reservationSlotsByLeague) {
  const canonical = new Map()

  for (const [league, slots] of reservationSlotsByLeague.entries()) {
    canonical.set(league, slots)
  }

  for (const round of rounds) {
    if (!canonical.has(round.league) && round.timeSlots.length > 0) {
      canonical.set(round.league, round.timeSlots)
    }
  }

  return canonical
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
  const golfGeniusConfig = await loadJson(GOLF_GENIUS_CONFIG_PATH)
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
        }))
    )
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate))

  const roundsWithSlots = []

  for (const round of futureRounds) {
    const golfEvent = leagueEvents[round.league]
    const timeSlots = await fetchRoundTimeSlots({
      eventId: golfEvent.id || golfEvent.event_id,
      roundId: round.roundId,
    })

    roundsWithSlots.push({
      ...round,
      golfEventId: golfEvent.id || golfEvent.event_id,
      timeSlots,
    })
  }

  const reservationSlotsByLeague = await fetchReservationPageSlotsByLeague(golfGeniusConfig)
  const canonicalSlotsByLeague = chooseCanonicalSlotsByLeague(roundsWithSlots, reservationSlotsByLeague)
  const summary = []

  for (const round of roundsWithSlots) {
    const canonicalSlots = canonicalSlotsByLeague.get(round.league) || []
    const resolvedTimeSlots =
      canonicalSlots.length > round.timeSlots.length
        ? canonicalSlots
        : round.timeSlots.length > 0
          ? round.timeSlots
          : canonicalSlots

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
      resolvedTimeSlots,
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
