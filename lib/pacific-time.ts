// Pacific-timezone calendar helpers. League/companion tables store dates (not
// instants), and the league registration schedule is defined in Pacific, so
// "today" comparisons must use the Pacific calendar day rather than the server
// clock's UTC day. Keeping this in one place avoids per-page drift.

export function pacificToday(): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date())
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}