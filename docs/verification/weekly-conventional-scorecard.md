# Weekly conventional scorecard

## Authoritative facts verified 2026-09-22

The source is Golf Genius API v2 `GET /events/{eventId}/rounds/{roundId}/tee_sheet`, already used by Seattle Cup. Each `pairing_group.players[]` supplies `member_card_id`, `player_round_id`, `handicap_dots_by_hole`, `score_array`, and tee metadata. Tournament `member_card_id_str` joins exactly to the tee-sheet string ID within the requested event and round; unsafe numeric IDs and duplicate identities do not join.

Interbay's tee declares `nine_hole_course: true`, played labels 1–9, and nine populated par values. The first nine array entries correspond to holes 1–9; the 18-slot array is padded. Allocation entries are counts: explicit zero is known no stroke, positive integers include multiple strokes, and absent/invalid entries are unknown. Plus-handicap semantics were not established by this sample; negative entries remain unknown.

The displayed hole-handicap sequence `3,11,17,15,7,1,5,13,9` orders the nine holes. Comparing its numeric values directly against the nine-hole course handicap is incorrect. No conversion, handicap calculation, or Gross/Net subtraction is used: the supplied allocation is copied directly.

All 630 player-rounds examined in Men's Weeks 1/23/24 and Women's Weeks 1/17/22 have allocations totaling the supplied nonnegative nine-hole course handicap; 164 have multiple strokes on a hole. The same allocations agree observationally with the ordering of the nine holes. The implementation depends on explicit allocation, not that observation.

- **Jeff Morgan:** member card `2925267424527804043`, Men's event `12263651301715371717`. Week 23 round `12263654987904607775` / player-round `12333468412910004055`; Week 24 round `12263654991796921888` / player-round `12333468413379765873`. Both course handicaps are 4 and both explicit allocations are `1,0,0,0,1,1,1,0,0`: exactly holes 1,5,6,7.
- **Tim Eichelberger:** same event / Week 23 round, member card `2925267430701819571`, player-round `12333468412708677357`. Course handicap 7; allocation `1,1,0,0,1,1,1,1,1`. The user corrected the earlier eight-stroke fixture: hole 3 receives **zero** strokes. Actual scores `5,3,2,3,3,4,5,4,3`; Gross 32/+4; Net 25/−3. Hole 3 remains actual 2 and a birdie in both modes. Gross tournament `12263682216587978599` and Net tournament `12263682231586809704` were independently checked.
- **Jamie Lim:** Women's event `12295846036726900454`, Week 17 round `12295846338247026448`, member card `11464114002137737023`, player-round `12341638379325122417`. Allocation `2,1,1,1,2,2,2,1,2` totals 14. Gross 38/+10; Net 24/−4.

Compact captured source fixtures are in `tests/fixtures/weekly-player-rounds.json`; mode-specific score fixtures are in `tests/fixtures/weekly-scorecard-context.ts`.

## Read model and presentation

A shared supplemental read adds `actualStrokes` and `handicapStrokes` to Weekly holes. Existing non-Weekly producers may omit these optional transport fields; the Weekly projection always emits explicit number-or-null values. Actual scores come from the independent tee-sheet `score_array`; when that source is unavailable the established Gross score is retained, never a calculated Net score. Unplayed tournament holes remain blank even if the tee sheet is newer. Supplemental source failures preserve leaderboard results with unknown allocations.

The cache is scoped by tenant, competition, occurrence, event and round, shared across scoring modes, and expires after 30 seconds. Live flight projection reuses the read. Historical reads retain their stored scores/awards/progress and add the same player-round facts. There are no migrations, imported-data updates, repairs, or identity changes.

Only the expanded card is redesigned: aligned Hole, Par and actual Score rows, an actual-stroke Out subtotal, and the selected competition's aggregate above. Circles/squares encode selected-mode authoritative performance; double outlines cover eagle-or-better and double-bogey-or-worse. Net hole headers carry explicit handicap dots; unknown allocation uses a small question mark. Nine columns fit a phone without horizontal scrolling. Gross shows no dots or Net aggregate. Partial cards retain nine holes and existing THRU semantics.

## Regression coverage and visual review

Focused unit coverage includes corrected Tim/Jeff allocations, Women’s multiple strokes, unknown versus zero, unsafe/ambiguous identity joins, cache isolation across rounds, unavailable source behavior, independent Net-only actual scores, partial/future holes, and live discovery through Gross→Net→Gross. Existing completion and scoring-context suites remain green.

The browser matrix covers 1440px desktop and 390px mobile: Tim and Jamie’s historical fixtures, Jeff’s exact four holes, Marnie Hendrix’s partial Women’s Week 3 card, current Men’s Week 24 (Joe Myxter), and latest available Women’s Week 22 (Victoria Lea). It checks mode switching, actual numbers, conventional marks, allocation headers, nine columns, blank future holes, THRU, overflow, and browser runtime errors. Screenshots were visually reviewed. No active Women’s round was available; the latest completed round and injected live read-model coverage exercise that path.

Final-commit validation and exact GitHub/Vercel deployment provenance are recorded in the delivery report/PR.
