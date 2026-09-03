import type { ResultStatus } from '../../lib/competition/types.ts'

// Normal historical rounds stay quiet. Only exceptional states are added to
// the occurrence itself, keeping scoring status independent from flight state.
export function occurrenceContextLabel(label: string, status: ResultStatus): string {
  if (status === 'live') return `${label} (Live)`
  if (status === 'not_started') return `${label} (Upcoming)`
  return label
}
