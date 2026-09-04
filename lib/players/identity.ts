export const IGC_MENS_2026_SCOPE = 'igc-mens-2026'

export interface IdentityAppearance {
  externalId: string | null
  displayName: string | null
}

export interface IdentityResolution {
  externalId: string
  displayName: string | null
  status: 'resolved' | 'unresolved'
  reason:
    | 'unique_scoped_member_card'
    | 'ambiguous_display_names'
    | 'missing_display_name'
    | 'generic_guest_slot'
}

export function normalizeObservedName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function isGenericGuestName(value: string): boolean {
  return /(^|[^a-z])(guest|tbd|unknown|walk.?in|player\s*\d+)([^a-z]|$)/i.test(value)
}

// V1 deliberately resolves *within* a supplied external card. It never groups
// cards by name, so two cards carrying the same name remain two people until a
// stronger explicit identity link exists.
export function resolveScopedIdentities(appearances: IdentityAppearance[]): IdentityResolution[] {
  const byExternalId = new Map<string, string[]>()
  for (const appearance of appearances) {
    const externalId = appearance.externalId?.trim()
    if (!externalId) continue
    const names = byExternalId.get(externalId) ?? []
    if (appearance.displayName?.trim()) names.push(appearance.displayName.trim())
    byExternalId.set(externalId, names)
  }

  return [...byExternalId.entries()].map(([externalId, observedNames]) => {
    const normalized = [...new Set(observedNames.map(normalizeObservedName))]
    const displayName = [...observedNames].sort((a, b) => a.localeCompare(b)).at(-1) ?? null
    if (normalized.length === 0) {
      return { externalId, displayName, status: 'unresolved', reason: 'missing_display_name' }
    }
    if (normalized.length > 1) {
      return { externalId, displayName, status: 'unresolved', reason: 'ambiguous_display_names' }
    }
    if (isGenericGuestName(normalized[0])) {
      return { externalId, displayName, status: 'unresolved', reason: 'generic_guest_slot' }
    }
    return { externalId, displayName, status: 'resolved', reason: 'unique_scoped_member_card' }
  })
}
