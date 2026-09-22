# Weekly partial-round completion

The current Men's Week 24 (2026-09-22, Season Points Finale) reproduces the defect. The public live response was live with projected flights. Of 136 cards, 119 had no scores and 17 had started: seven through 1, two through 3, four through 4, and four through 5. All four players through 5 incorrectly carried `isLive: false`: Joe Myxter, Abe Geballe, Jan Syberg, and Esteban Peredo. Abe had progressed from the reported four-hole Gross 18 / +5 to five-hole Gross 22 / +6 by inspection; Esteban was through 5, Gross 28 / +12.

## Cause and scope

`roundHoleCount` in `lib/igc/weekly-results-helpers.ts` treated the maximum `holesCompleted` across the field as the required course length. `trimScorecardsToRoundHoles` then truncated every card to that length and marked the furthest players complete. This affects the live leaders (including ties), not every player, until someone completes nine holes. It also hides the remaining holes in expanded cards.

Both the generic Golf Genius discovery reader and legacy Weekly live reader call this helper. Men's and Women's use the same implementation, as do Gross and Net. Historical readers additionally disabled progress recomputation; both generic and legacy row components gated card progress on event liveness. Consequently a historical partial card could display F regardless of holes played. Fully completed nine-hole historical cards are unaffected. Historical exposure is established from the code paths; this investigation does not claim a database-wide count of partial historical cards.

## Repair

Interbay Weekly requires nine holes, including each separate Club Championship round. The shared helper now shapes cards to that requirement independently of field progress and recomputes partial status for live and historical readers. An explicit required-hole argument supports other round lengths; no current Weekly caller is an eighteen-hole format. The legacy boolean argument remains for reader compatibility and cannot override completion.

Desktop/mobile rows, participation labels, and the legacy view compare completed holes with the shaped round length (with the Weekly nine-hole minimum). Event finality, projected flights, score totals, and old `isLive` flags cannot turn four holes into F. Expanded cards retain all nine holes, including unplayed holes. Gross, Net, and to-par totals are unchanged.

No database, import, reconciliation, security, deployment configuration, or Women's historical Net repair changes are included.

Regression coverage includes the exact 5, 4, 4, 5 = 18 / +5 shape, both leagues and scoring modes through discovery, live/historical shaping, empty/mixed fields without a completed player, stale completion flags, completed nine-hole cards, and explicit eighteen-hole rounds still partial through nine.
