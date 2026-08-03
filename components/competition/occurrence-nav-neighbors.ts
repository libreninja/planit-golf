// Pure neighbor resolution for the occurrence nav, extracted from the client
// component so the temporal direction contract is unit-testable independent of
// React. Occurrences are received in CHRONOLOGICAL order (oldest→newest):
//   - the LEFT chevron (prev) moves to the OLDER occurrence (index - 1)
//   - the RIGHT chevron (next) moves to the NEWER occurrence (index + 1)
// prev is null (left disabled) at the oldest dataset; next is null (right
// disabled) at the newest. See P3.

export interface NavOcc { id: string; label: string }

export function occurrenceNavNeighbors(
  occurrences: NavOcc[],
  selectedId: string | null,
): { prev: NavOcc | null; next: NavOcc | null; index: number } {
  if (occurrences.length === 0 || selectedId === null) {
    return { prev: null, next: null, index: -1 }
  }
  const index = occurrences.findIndex((o) => o.id === selectedId)
  if (index < 0) return { prev: null, next: null, index: -1 }
  const prev = index > 0 ? occurrences[index - 1] : null               // older
  const next = index < occurrences.length - 1 ? occurrences[index + 1] : null  // newer
  return { prev, next, index }
}
