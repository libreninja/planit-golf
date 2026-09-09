import { displayPersonName, type StructuredPersonName } from './person-name.ts'

export function normalizePlayerSearch(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

export function displayedPlayerNameMatches(
  player: string | StructuredPersonName,
  query: string,
): boolean {
  const normalizedQuery = normalizePlayerSearch(query)
  if (!normalizedQuery) return true
  return normalizePlayerSearch(displayPersonName(player)).includes(normalizedQuery)
}
