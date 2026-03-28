import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { createClient } from "@supabase/supabase-js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.join(__dirname, "..")

const GIDIOT_DIR = "/Users/jbizzle/dev/gidiot"
const GIDIOT_ENV_PATH = path.join(GIDIOT_DIR, ".env")
const GIDIOT_ROSTERS_PATH = path.join(GIDIOT_DIR, "dist/tools/rosters.js")
const GIDIOT_EVENTS_PATH = path.join(GIDIOT_DIR, "dist/tools/events.js")
const PLAYERS_JSON_PATH = "/Users/jbizzle/projects/while-supplies-last/src/data/players.json"
const OVERRIDES_PATH = path.join(__dirname, "member-overrides.json")
const LOCAL_ENV_PATH = path.join(REPO_ROOT, ".env.local")
const LEAGUE_EVENT_PATTERNS = {
  mens: /IGC Mens League 2026/i,
  womens: /IGC Women's League 2026/i,
}

function normalizeName(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

function normalizeEmail(value) {
  return value.trim().toLowerCase()
}

function titleCaseName(value) {
  return value
    .split(",")
    .map((part) =>
      part
        .trim()
        .split(/\s+/)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
        .join(" ")
    )
    .join(", ")
}

async function loadJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"))
  } catch {
    return fallback
  }
}

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
    // Ignore missing local env file.
  }
}

async function fetchGolfGeniusLeagueRosters() {
  await loadEnvFile(GIDIOT_ENV_PATH)
  const { getEvents } = await import(GIDIOT_EVENTS_PATH)
  const { getEventRoster, getMasterRoster } = await import(GIDIOT_ROSTERS_PATH)

  const eventsResponse = await getEvents({ page: 1 })
  const events = (Array.isArray(eventsResponse) ? eventsResponse : eventsResponse?.events || [])
    .map((row) => row.event || row)
    .filter(Boolean)

  const rosterRows = []

  for (const [league, pattern] of Object.entries(LEAGUE_EVENT_PATTERNS)) {
    const event = events.find((candidate) => pattern.test(candidate.name || ""))
    if (!event) {
      throw new Error(`Could not find Golf Genius event for ${league}`)
    }

    const rosterResponse = await getEventRoster({ event_id: event.id || event.event_id, page: 1 })
    const rows = (Array.isArray(rosterResponse) ? rosterResponse : rosterResponse?.roster || [])
      .map((row) => row.member || row)
      .filter(Boolean)
      .map((member) => ({ ...member, league }))

    rosterRows.push(...rows)
  }

  const masterRosterRows = []
  for (let page = 1; page <= 25; page += 1) {
    const rosterResponse = await getMasterRoster({ page })
    const rows = (Array.isArray(rosterResponse) ? rosterResponse : rosterResponse?.roster || rosterResponse?.members || [])
      .map((row) => row.member || row)
      .filter(Boolean)

    if (rows.length === 0) break
    masterRosterRows.push(...rows)
  }

  const mergedByName = new Map()
  for (const player of [...masterRosterRows, ...rosterRows]) {
    const golfMemberName = player.name || `${player.last_name}, ${player.first_name}`.trim()
    const normalizedName = normalizeName(golfMemberName)
    const existing = mergedByName.get(normalizedName)

    mergedByName.set(normalizedName, {
      ...player,
      name: golfMemberName,
      email: player.email || existing?.email || null,
      league: player.league || existing?.league,
    })
  }

  return Array.from(mergedByName.values())
}

function buildLocalRoster(playersJson) {
  const entries = []
  for (const [league, players] of Object.entries(playersJson || {})) {
    for (const [golfMemberName, data] of Object.entries(players)) {
      entries.push({
        league,
        golf_member_name: golfMemberName,
        golf_member_id: data.member_id,
        normalized_name: normalizeName(golfMemberName),
      })
    }
  }
  return entries
}

function mergeMembers({ golfGeniusRoster, localRoster, overrides }) {
  const localByName = new Map(localRoster.map((entry) => [entry.normalized_name, entry]))

  const matchedMembers = []
  const unmatchedGolfGenius = []

  for (const player of golfGeniusRoster) {
    const golfMemberName = player.name || `${player.last_name}, ${player.first_name}`.trim()
    const normalizedName = normalizeName(golfMemberName)
    const localEntry =
      localByName.get(normalizedName) ||
      localByName.get(normalizeName(titleCaseName(golfMemberName)))

    if (!localEntry) {
      unmatchedGolfGenius.push({
        golfMemberName,
        email: player.email || null,
      })
      continue
    }

    const override = overrides?.[localEntry.golf_member_id] || overrides?.[localEntry.golf_member_name] || {}
    const email = override.email || player.email || null
    if (!email) {
      unmatchedGolfGenius.push({
        golfMemberName,
        reason: "missing email",
      })
      continue
    }

    matchedMembers.push({
      display_name:
        override.display_name ||
        `${player.first_name || ""} ${player.last_name || ""}`.trim() ||
        titleCaseName(localEntry.golf_member_name).replace(",", ""),
      email: normalizeEmail(email),
      phone: override.phone || null,
      golf_member_name: localEntry.golf_member_name,
      golf_member_id: localEntry.golf_member_id,
      active: override.active ?? true,
      is_admin: override.is_admin ?? false,
      is_system_admin: override.is_system_admin ?? false,
      league: localEntry.league,
    })
  }

  const matchedIds = new Set(matchedMembers.map((member) => member.golf_member_id))
  const unmatchedLocal = localRoster
    .filter((entry) => !matchedIds.has(entry.golf_member_id))
    .map((entry) => ({
      golf_member_name: entry.golf_member_name,
      golf_member_id: entry.golf_member_id,
      league: entry.league,
    }))

  return {
    matchedMembers: matchedMembers.sort((a, b) => a.display_name.localeCompare(b.display_name)),
    unmatchedGolfGenius,
    unmatchedLocal,
  }
}

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for live sync")
  }

  return createClient(supabaseUrl, serviceRoleKey)
}

async function upsertMembers(supabase, members) {
  const payload = members.map(({ is_admin, is_system_admin, ...member }) => member)
  const { error } = await supabase.from("members").upsert(payload, { onConflict: "golf_member_id" })
  if (error) throw error
}

async function syncProfiles(supabase, members, { dryRun }) {
  const roleMembers = members.filter((member) => member.is_admin || member.is_system_admin)
  if (roleMembers.length === 0) {
    return { updatedProfiles: 0, missingProfiles: [] }
  }

  const emails = roleMembers.map((member) => member.email)
  const golfIds = roleMembers.map((member) => member.golf_member_id)

  const [{ data: profiles, error: profilesError }, { data: memberRows, error: membersError }] = await Promise.all([
    supabase.from("profiles").select("id, email, is_admin, is_system_admin, member_id").in("email", emails),
    supabase.from("members").select("id, email, golf_member_id").in("golf_member_id", golfIds),
  ])

  if (profilesError) throw profilesError
  if (membersError) throw membersError

  const profilesByEmail = new Map((profiles || []).map((profile) => [normalizeEmail(profile.email || ""), profile]))
  const membersByGolfId = new Map((memberRows || []).map((member) => [member.golf_member_id, member]))

  let updatedProfiles = 0
  const missingProfiles = []

  for (const member of roleMembers) {
    const profile = profilesByEmail.get(normalizeEmail(member.email))
    if (!profile) {
      missingProfiles.push({
        email: member.email,
        display_name: member.display_name,
        is_admin: member.is_admin,
        is_system_admin: member.is_system_admin,
      })
      continue
    }

    const memberRow = membersByGolfId.get(member.golf_member_id)
    const nextValues = {
      is_admin: member.is_admin,
      is_system_admin: member.is_system_admin,
      member_id: memberRow?.id || profile.member_id || null,
    }

    const noChange =
      profile.is_admin === nextValues.is_admin &&
      profile.is_system_admin === nextValues.is_system_admin &&
      profile.member_id === nextValues.member_id

    if (noChange) continue

    if (!dryRun) {
      const { error } = await supabase
        .from("profiles")
        .update(nextValues)
        .eq("id", profile.id)

      if (error) throw error
    }

    updatedProfiles += 1
  }

  return { updatedProfiles, missingProfiles }
}

async function main() {
  await loadEnvFile(LOCAL_ENV_PATH)
  const dryRun = process.argv.includes("--dry-run")
  const outputJson = process.argv.includes("--json")
  const overrides = await loadJson(OVERRIDES_PATH, {})
  const playersJson = await loadJson(PLAYERS_JSON_PATH, {})
  const localRoster = buildLocalRoster(playersJson)
  const golfGeniusRoster = await fetchGolfGeniusLeagueRosters()
  const result = mergeMembers({ golfGeniusRoster, localRoster, overrides })

  let profileSync = { updatedProfiles: 0, missingProfiles: [] }

  if (!dryRun) {
    const supabase = getSupabaseClient()
    await upsertMembers(supabase, result.matchedMembers)
    profileSync = await syncProfiles(supabase, result.matchedMembers, { dryRun: false })
  } else if (result.matchedMembers.some((member) => member.is_admin || member.is_system_admin)) {
    const supabase = getSupabaseClient()
    profileSync = await syncProfiles(supabase, result.matchedMembers, { dryRun: true })
  }

  if (outputJson) {
    console.log(JSON.stringify({ ...result, profileSync }, null, 2))
    return
  }

  console.log(`Matched members: ${result.matchedMembers.length}`)
  console.log(`Unmatched Golf Genius entries: ${result.unmatchedGolfGenius.length}`)
  console.log(`Unmatched local JSON entries: ${result.unmatchedLocal.length}`)
  console.log(`Profiles requiring role sync: ${profileSync.updatedProfiles}`)
  console.log(`Role-bearing members without profiles: ${profileSync.missingProfiles.length}`)

  if (result.unmatchedGolfGenius.length > 0) {
    console.log("\nSample unmatched Golf Genius entries:")
    for (const entry of result.unmatchedGolfGenius.slice(0, 10)) {
      console.log(`- ${entry.golfMemberName}${entry.reason ? ` (${entry.reason})` : ""}`)
    }
  }

  if (result.unmatchedLocal.length > 0) {
    console.log("\nSample unmatched local JSON entries:")
    for (const entry of result.unmatchedLocal.slice(0, 10)) {
      console.log(`- ${entry.golf_member_name} [${entry.league}]`)
    }
  }

  if (profileSync.missingProfiles.length > 0) {
    console.log("\nRole-bearing members without profiles:")
    for (const entry of profileSync.missingProfiles.slice(0, 10)) {
      const labels = []
      if (entry.is_system_admin) labels.push("system")
      if (entry.is_admin) labels.push("bigdeal")
      console.log(`- ${entry.display_name} <${entry.email}> [${labels.join(", ")}]`)
    }
  }

  if (dryRun) {
    console.log("\nDry run only. No Supabase changes were written.")
  } else {
    console.log("\nSupabase members and matching profile roles updated.")
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
