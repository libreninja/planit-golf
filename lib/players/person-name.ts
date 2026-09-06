export interface StructuredPersonName {
  sourceName: string
  firstName?: string | null
  lastName?: string | null
}

const SUFFIX = /^(?:jr\.?|sr\.?|ii|iii|iv|v)$/i

function cleanPart(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, ' ') ?? ''
}

function givenFamilyName(givenValue: string, familyValue: string): string {
  const givenTokens = givenValue.split(' ')
  const suffix = givenTokens.length > 1 && SUFFIX.test(givenTokens.at(-1) ?? '')
    ? givenTokens.pop()
    : null
  const givenName = givenTokens.join(' ')
  if (!givenName) return [givenValue, familyValue].filter(Boolean).join(' ')
  return [givenName, familyValue, suffix].filter(Boolean).join(' ')
}

// Presentation only. The original canonical/source string remains the identity
// and provenance value everywhere else. Structured provider fields win when
// both are present; otherwise only one unambiguous comma is reversed.
export function displayPersonName(input: string | StructuredPersonName): string {
  if (typeof input !== 'string') {
    const firstName = cleanPart(input.firstName)
    const lastName = cleanPart(input.lastName)
    if (firstName && lastName) return givenFamilyName(firstName, lastName)
    return displayPersonName(input.sourceName)
  }

  const sourceName = cleanPart(input)
  const commaCount = [...sourceName].filter((character) => character === ',').length
  if (commaCount !== 1) return sourceName

  const [familyPart, givenPart] = sourceName.split(',').map(cleanPart)
  if (!familyPart || !givenPart) return sourceName

  return givenFamilyName(givenPart, familyPart)
}

export function displayPersonFirstName(input: string | StructuredPersonName): string {
  const displayName = displayPersonName(input)
  return displayName.split(/\s+/)[0] || displayName
}
