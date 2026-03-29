import fs from 'fs/promises'
import path from 'path'

const overridesPath = path.join(process.cwd(), 'scripts', 'member-overrides.json')
let overridesCache: Promise<Record<string, OverrideEntry>> | null = null

type OverrideEntry = {
  email?: string
  is_system_admin?: boolean
}

async function loadOverrides(): Promise<Record<string, OverrideEntry>> {
  if (overridesCache) {
    return overridesCache
  }

  overridesCache = (async () => {
    try {
      const raw = await fs.readFile(overridesPath, 'utf8')
      return JSON.parse(raw)
    } catch {
      return {}
    }
  })()

  try {
    return await overridesCache
  } catch {
    overridesCache = null
    return {}
  }
}

export async function getSystemAdminEmails() {
  const overrides = await loadOverrides()
  return Object.values(overrides)
    .filter((entry) => entry.is_system_admin && typeof entry.email === 'string')
    .map((entry) => entry.email!.trim().toLowerCase())
}

export async function isConfiguredSystemAdminEmail(email: string | null | undefined) {
  if (!email) return false
  const normalizedEmail = email.trim().toLowerCase()
  const adminEmails = await getSystemAdminEmails()
  return adminEmails.includes(normalizedEmail)
}
