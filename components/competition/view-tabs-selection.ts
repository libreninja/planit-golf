// Pure selection state for the ViewTabs segmented control (FIX 3). Extracted
// so the optimistic single-selection behavior is unit-testable without React.
//
// The bug this fixes: with `active = selectedView === v` and a separate
// `pending = pendingView === v`, BOTH the old server-selected tab (active) and
// the clicked tab (pending) carry the filled "selected" background while a
// navigation is in flight — two buttons look selected at once. The fix is a
// single displayed selection: while in flight the PENDING view is the sole
// selected tab; otherwise the SERVER-confirmed view is. Only one tab is ever
// active. The pending spinner still rides on the pending tab.
//
// Relative import (no @/ alias) so `node --test` can load this module.

export interface TabSelectionState {
  // The sole visually-selected tab (filled background). Only one tab has this
  // true at any time.
  active: boolean
  // True on the in-flight tab only — drives the spinner + cursor-progress.
  pending: boolean
}

// `selectedView` is the server-confirmed view (the one the URL currently
// resolves to). `pendingView` is the view the user just clicked (null before
// any click this session, inert once the server catches up because
// pendingView === selectedView). `v` is the tab being rendered.
export function tabSelectionState(
  selectedView: string,
  pendingView: string | null,
  v: string,
): TabSelectionState {
  const inFlight = pendingView !== null && pendingView !== selectedView
  // While in flight, the pending view is the sole selection — the previous
  // server view immediately loses its fill. Once the server catches up
  // (inFlight false), the server view is the selection again.
  const active = inFlight ? pendingView === v : selectedView === v
  const pending = inFlight && pendingView === v
  return { active, pending }
}
