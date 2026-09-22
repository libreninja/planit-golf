# Weekly expanded scoring context

The selected mode already flowed from the Gross/Net control in `standings-shell.tsx` to `initialByScoring[scoring]`, the Weekly workspace's leaderboard, and `ScorecardRow.scoringMode`. Desktop result cells and the mobile stat strip selected the correct totals. The boundary broke at expansion: `ScorecardRow` passed only the shared two-mode card to its private renderer. That renderer printed both aggregates and paired `hole.gross` with `hole.toPar` (the Net delta). The retained legacy `WeeklyResultsView` repeated this behavior and also narrated running Net to-par under Gross rows.

`scorecard-context.ts` now projects the authoritative card into a single selected result before rendering: label, total, aggregate to-par, and holes with selected strokes/deltas. Gross deltas use gross strokes minus hole par (or the authoritative Gross delta when par is unavailable). Net uses the authoritative Net strokes and per-hole Net deltas. Missing values remain unknown; neither mode falls back to the other. The renderer receives no alternate-mode score fields. Both Weekly renderers use `ExpandedScorecard`; legacy narration also receives only selected-mode deltas.

Net hole scores are already authoritative facts established by #41's separate Gross/Net tournament assembly. Showing these scores alongside their Net deltas is consistent with the selected result and requires no handicap reconstruction. Course par remains the same course fact. No raw-stroke overlay is added to Net cards.

Authoritative regression examples captured from each mode's Golf Genius payload on 2026-09-22:

| Player / occurrence | Gross holes | Gross result | Net holes | Net result |
| --- | --- | --- | --- | --- |
| Tim Eichelberger, Men's Week 23 | 5,3,2,3,3,4,5,4,3 | 32 (+4) | 4,2,2,3,2,3,4,3,2 | 25 (-3) |
| Jamie Lim, Women's Week 17 | 4,5,3,4,3,5,4,5,5 | 38 (+10) | 2,4,2,3,1,3,2,4,3 | 24 (-4) |

Par is 4,3,3,3,3,3,3,3,3. Tim's Gross annotations are +1,E,-1,E,E,+1,+2,+1,E and sum to +4. His authoritative Net annotations are E,-1,-1,E,-1,E,+1,E,-1 and sum to -3.

Unit regressions assert mode isolation, hole/aggregate reconciliation, exact Tim annotations, both leagues, mobile-result agreement, zero Net scores, unknown fields, immutable input, and partial-round blanks/THRU. Browser coverage exercises Gross → Net → Gross using the real control, checks both aggregates and every rendered hole, and covers Men's/Women's at 1440px/390px. A Women's Week 3 partial card (Marnie Hendrix) verifies nine displayed holes with five unplayed holes and `thru 4` in both modes and viewport sizes.

The change is confined to presentation and regression coverage. #42's course length, progress, completion and THRU logic is untouched. No import, reconciliation, stored score, identity, database, authentication or deployment configuration changes are included.
