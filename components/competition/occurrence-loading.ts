export function isOccurrenceNavigationPending(
  selectedOccurrenceId: string | null,
  pendingOccurrenceId: string | null,
): boolean {
  return pendingOccurrenceId !== null && pendingOccurrenceId !== selectedOccurrenceId
}

/** The user's navigation choice is the control-panel truth while data catches up. */
export function selectedOccurrenceContextId(
  loadedOccurrenceId: string | null,
  pendingOccurrenceId: string | null,
): string | null {
  return pendingOccurrenceId ?? loadedOccurrenceId
}

export function isLatestResultsDisabled(
  selectedOccurrenceId: string | null,
  latestResultsOccurrenceId: string | null,
): boolean {
  return latestResultsOccurrenceId === null || selectedOccurrenceId === latestResultsOccurrenceId
}
