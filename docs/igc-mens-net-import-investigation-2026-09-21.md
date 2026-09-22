# IGC Men’s League Net importer investigation

**Investigated 2026-09-21. Read-only; no implementation, production writes, backfill, or UI changes.**

The importer drops authoritative Net scorecard facts after processing Gross. The confirmed Men’s blast radius is **1,153 performance rows, 204 distinct Golf Genius member-card IDs, seven regular weeks (17–23), and two Championship rounds (101/102)**. All four Net score fields are wrong on those rows; 916 birdie counts and 692 double-bogey counts are also wrong. Gross score facts and the persisted mode-specific placement/award facts match the current source.

**PR #40’s awards correction remains correct.** Its 506 Week 22/23 result rows and 253 performance award copies match the current mode-specific Golf Genius payloads. Their Net score problems predate that release. Fixing only `net_total` would leave incorrect holes, to-par, statistics, ordering, and live Player Detail data.

## Evidence and comparison method

Production GitHub main was confirmed through the GitHub API as `c97d5d91b8cfe0f226d50da65a59177dcf9f2f21` ([PR #40](https://github.com/libreninja/planit-golf/pull/40)). The working branch is older; this report cites the immutable production source. The relevant importer/normalizer/read files are unchanged between the local source and production. No checkout or source edit was performed.

Read all rows of the five relevant production tables with stable-ID pagination and uniqueness checks: 48 events, 9,840 results, 5,137 performances, 3,519 season entries, and 265 season standings. Men’s subset: 26 events, 7,068 results, 3,536 performances, 3,519 entries, 265 standings. Women’s subset: 22 events, 2,772 results, 1,601 performances, no season entries/standings.

Fetched **86 current tournament payloads independently**: 52 Men’s (25 completed occurrences plus empty Week 24, both modes), 34 Women’s (17 resolved occurrences, both modes), plus course/par payloads. Tournament fetch window: **2026-09-21 23:41:56–23:42:42 UTC**. Sources are the persisted event/round/tournament IDs at `/events/{event}/rounds/{round}/tournaments/{tournament}.json`, not importer output or inferred handicap arithmetic. Final repeat reads at **23:47:11 UTC** found all five tables unchanged.

Comparison treats empty/null purse as no award, preserves numeric money, treats `--`/null position as unplaced, preserves `T` tie labels, and accounts for the database’s two-decimal season-entry precision. Rows are matched by member ID **and name**, so duplicate identities are surfaced rather than silently collapsed. Gross and Net arrays, totals, to-par, status, placement, points, and purse were compared separately. Derived Net counts use the fetched course/tee par, matching the existing metric definition. A second independent code/research pass reproduced the Men’s score and count totals.

Local evidence (contains source snapshots and golfer data; not committed):

- [Fetch manifest, endpoint IDs, timestamps and SHA-256 payload hashes](/private/tmp/igc-net-investigation/manifest.json)
- [Production before-image](/private/tmp/igc-net-investigation/db.json), [independent Gross/Net payloads](/private/tmp/igc-net-investigation/upstream.json), [course/par payloads](/private/tmp/igc-net-investigation/courses.json)
- [Complete comparisons and examples](/private/tmp/igc-net-investigation/analysis.json), [attribution and season verification](/private/tmp/igc-net-investigation/supplement.json), [unchanged-state proof](/private/tmp/igc-net-investigation/stability.json)
- [Exact proposed Men’s row/field backfill manifest — not executed](/private/tmp/igc-net-investigation/proposed-mens-backfill.json)
- [Earlier PR #40 before/after discrepancy evidence](/private/tmp/igc-awards-release/preexisting-net-score-discrepancy.json)

These `/private/tmp` artifacts are local investigation evidence, not a permanent repository archive. The quantified findings and proposal are retained in this report.

## Complete path and exact failure

1. Discovery resolves separate Gross and Net tournament IDs and excludes individual-incompatible team/scramble competitions. Each selected payload is normalized independently. [Discovery](https://github.com/libreninja/planit-golf/blob/c97d5d91b8cfe0f226d50da65a59177dcf9f2f21/lib/competition/adapters/golfgenius/discovery.ts#L267)
2. Normalization retains the tournament’s arrays and totals. It prefers `totals.<field>.out`, then `.total`, then a sum of present holes for live fallback. The `competition` argument labels the result mode; it does not transform Gross-context `net_scores` into authoritative Net-tournament facts. [Normalizer](https://github.com/libreninja/planit-golf/blob/c97d5d91b8cfe0f226d50da65a59177dcf9f2f21/lib/competition/adapters/golfgenius/normalize.ts#L57)
3. `importOccurrence` loops **Gross, then Net**. Each pass emits a separate result row with that mode’s flight, `position`, points and purse. A performance map keyed by player name stores a single combined scorecard. The Gross pass initializes all arrays, totals, counts, and lifecycle fields. [Import](https://github.com/libreninja/planit-golf/blob/c97d5d91b8cfe0f226d50da65a59177dcf9f2f21/lib/competition/reconcile/import.ts#L86)
4. On the Net pass, the existing-player branch updates only `flight_name`, `position_label`, `flight_position`, `points`, `purse`, and `weekly_position`, then executes `continue`. It never copies Net holes or totals and never recomputes counts. The comment explicitly asserts that Gross and Net scorecard facts are identical. **That assertion is false. Net normalization succeeds; the merge discards its score facts.** [Discard point](https://github.com/libreninja/planit-golf/blob/c97d5d91b8cfe0f226d50da65a59177dcf9f2f21/lib/competition/reconcile/import.ts#L119)
5. Persistence writes one performance per `(league_key, week_number, player_name)` and one result per `(league_key, week_number, member_card_id, competition)`. Results have **no score columns**; both modes join the shared performance. The source/durable marker certifies import completion/version, not semantic correctness. PR #40 delays that stamp until the season rebuild succeeds but leaves score assembly unchanged. [Result schema](https://github.com/libreninja/planit-golf/blob/c97d5d91b8cfe0f226d50da65a59177dcf9f2f21/supabase/migrations/20260731000000_baseline.sql#L1473), [Production orchestration](https://github.com/libreninja/planit-golf/blob/c97d5d91b8cfe0f226d50da65a59177dcf9f2f21/lib/competition/reconcile/reconcile.ts#L418)
6. Historical readers combine selected-mode result membership/awards with the persisted shared scorecard. Weekly displays Net totals/to-par and holes from that card. Its score-based ordering uses selected to-par, falling back to total; it does not recompute official award labels from strokes. Wrong Net facts therefore affect scores and potentially row order while correct labels/awards remain attached. [Historical read model](https://github.com/libreninja/planit-golf/blob/c97d5d91b8cfe0f226d50da65a59177dcf9f2f21/lib/competition/adapters/golfgenius/server-readers.ts#L277), [Weekly reader selection](https://github.com/libreninja/planit-golf/blob/c97d5d91b8cfe0f226d50da65a59177dcf9f2f21/components/competition/standings-workspace-server.tsx#L177), [Ordering](https://github.com/libreninja/planit-golf/blob/c97d5d91b8cfe0f226d50da65a59177dcf9f2f21/components/competition/leaderboard-sort.ts#L7)
7. Season standings sum authoritative `event.season_points` captured separately for both modes. Wins count result `flight_position=1`; events played count performances with a scored Gross hole. None of these depend on Net scores or Net birdie/double counts. [Standings algorithm](https://github.com/libreninja/planit-golf/blob/c97d5d91b8cfe0f226d50da65a59177dcf9f2f21/lib/competition/reconcile/season-points.ts#L81)

The original sync upserted full performance rows with Net processed last. The first shared importer ([f7af473](https://github.com/libreninja/planit-golf/commit/f7af473)) instead retained first-seen score facts. The “parity” change ([38d3e05](https://github.com/libreninja/planit-golf/commit/38d3e05), August 3) restored Net-last awards while retaining Gross-first score facts. Both predate PR #40. This history explains the split between correctly persisted earlier weeks and later affected imports; per-row historical writer provenance is not stored.

## Semantic model: what each fact means

| Fact | Authoritative source | Required interpretation |
|---|---|---|
| Gross tournament strokes | **Gross payload** `gross_scores`, `totals.gross_scores` | Gross competition score; preserve its own source. |
| Net tournament strokes | **Net payload** `net_scores`, `totals.net_scores` | Net competition score; never substitute Gross payload’s similarly named field. |
| Gross to-par | Gross payload `to_par_gross`, corresponding totals | Per-hole deltas and total relative to that tournament’s par. |
| Net to-par | Net payload `to_par_net`, corresponding totals | Independent authoritative deltas; cumulative display sums those deltas. |
| Leaderboard/award position | Selected payload `position` | Preserve `T1`, `T2`, etc.; `--` is unplaced. It is not necessarily score-order index. |
| Source list index | Aggregate `rank` | Distinct from award position; never use it to infer wins/points. |
| Award facts | Selected payload `points`, `purse` | Mode-specific official awards; do not recalculate from corrected scores. |
| Season points | Both payloads’ `event.season_points` | Sum per member/round, then across rounds; not reconstructed from weekly score or placement. |
| Birdies/doubles | Authoritative Net holes vs verified par | Existing columns are **Net** metrics. Doubles count double-or-worse (`>= par+2`). |
| Raw strokes | Separate raw scorecard evidence, if available | Not independently represented or established by these tournament aggregates. |

The current payloads prove Gross-context `net_scores` often just equals Gross strokes. All **3,536** Men’s paired aggregate records have this equality; Net payloads differ for **3,359** of them. Every matched Gross array/total agrees across the paired payloads in this capture, but that is observed equality, not permission to discard mode provenance.

Some source tournaments have `event.adjusted=true` (Men’s Weeks 5, 8, 11, 12, 18, 21 and Championship Round 2). The capture does not establish the meaning of that adjustment or prove the aggregates are unadjusted raw strokes. A durable correction must retain authoritative tournament scores rather than silently relabel them raw strokes or derive them from handicap. No Gross-plus-handicap reconstruction was used.

No current payload has conflicting non-null `out` and `total` values. The current `out`-first convention is therefore not the cause here, but it is insufficient as a universal 18-hole rule. Non-numeric top-level `total` values such as DNF/NS are dispositions, not numeric mismatches; numeric partial-hole totals must remain distinct from finishing status. Missing Net data must remain unknown rather than borrowing Gross fields. [Hole semantics](https://github.com/libreninja/planit-golf/blob/c97d5d91b8cfe0f226d50da65a59177dcf9f2f21/lib/igc/weekly-results-helpers.ts#L50)

## Quantified Men’s blast radius

| Occurrence | Date | Performance rows | Wrong Net facts | Wrong birdies | Wrong doubles |
|---|---|---:|---:|---:|---:|
| 17 | 2026-07-28 | 143 | 140 | 115 | 80 |
| 18 | 2026-08-04 | 143 | 137 | 105 | 85 |
| 19 | 2026-08-11 | 139 | 134 | 100 | 82 |
| 20 | 2026-08-25 | 129 | 124 | 102 | 77 |
| 21 | 2026-09-01 | 137 | 132 | 107 | 76 |
| 22 | 2026-09-08 | 121 | 119 | 95 | 80 |
| 23 | 2026-09-15 | 132 | 128 | 95 | 88 |
| Championship R1 (101) | 2026-08-17 | 115 | 112 | 92 | 59 |
| Championship R2 (102) | 2026-08-18 | 129 | 127 | 105 | 65 |
| **Total** | | **1,188** | **1,153** | **916** | **692** |

These are **914 affected performances in seven regular weeks**, plus **239 affected performances in two Championship rounds**, involving **204 distinct member IDs**. The other 35 performances in those occurrences match their Net source. All 2,348 performances in Weeks 1–16 currently match both authoritative score modes. This investigation covers the current 2026 production league inventory; it makes no claim about absent/deleted seasons.

| Persisted field | Incorrect Men’s rows | Explanation |
|---|---:|---|
| `net_scores` | 1,153 | Gross-context holes retained. |
| `to_par_net` | 1,153 | Gross-context per-hole deltas retained. |
| `net_total` | 1,153 | Gross-context total retained. |
| `to_par_net_total` | 1,153 | Gross-context to-par total retained. |
| `birdies` | 916 | Computed before authoritative Net holes arrive. |
| `double_bogeys` | 692 | Same; stored metric includes worse than double. |
| `gross_scores`, `to_par_gross`, `gross_total`, `to_par_gross_total` | 0 | Match independent Gross source for all 3,536 performances. |
| `holes_completed`, `scorecard_status` | 0 | Match source for current Men’s snapshot. |
| Performance `flight_name`, `position_label`, `flight_position`, `weekly_position`, `points`, `purse` | 0 | Semantically match Net placement/award source. |
| Result placement/ties/points/purse | 0 of 7,068 stored rows | Match the respective source mode, subject to the separate missing-key issue below. |
| Season weekly entries | 0 of 3,519 | Match both-mode source sums at stored precision. |

**Physical result rows corrupted by this score defect: zero. Net result views with a wrong joined scorecard: 1,153.** There are 2,376 result rows in the nine affected occurrences; a whole-occurrence reimport would touch these even though their persisted awards do not need repair.

The defect is not limited to a special payload/event shape or late-awards state. It activates whenever a golfer is present in both payloads and their Net facts differ. Net-only entries avoid this particular branch; identical values conceal it. Reimporting Weeks 1–16 with the **unfixed** importer would newly corrupt 2,206 currently correct Net cards. Do not run a broad replay before correcting the assembler and resolving unrelated collision cases.

### Representative examples

| Golfer / occurrence | Authoritative Gross strokes / to-par | Stored Net strokes / to-par | Authoritative Net strokes / to-par |
|---|---|---|---|
| Kevin Werlinger, Week 1 — correct older row | 26 / −2 | 23 / −5 | 23 / −5 |
| Kevin Werlinger, Week 20 | 28 / E | 28 / E | 25 / −3 |
| Kevin Werlinger, Week 21 | 33 / +5 | 33 / +5 | 30 / +2 |
| Kevin Werlinger, Week 22 | 27 / −1 | 27 / −1 | 24 / −4 |

Kevin’s Week 22 Gross holes are `[2,3,3,4,2,3,4,4,2]`; authoritative Net holes are `[1,3,3,4,2,2,3,4,2]`. His stored Net card retains the former. Gross award position is unplaced (`--`), while Net position is **1**, points **500**, purse **$45**—all correctly persisted. His Gross `rank=2` does not entitle him to Gross second-place awards. This is why strokes, row order, official placement, and award facts cannot be substituted for one another.

## PR #40 awards and season verification

The current authoritative comparison confirms all **242 Week 22** and **264 Week 23** result rows, across both modes, have the correct flights, placement/tie labels, points, and purse. Their **121 + 132 performance award copies** also match Net. The same weeks have **119 + 128** bad Net cards; the saved PR40 before/after snapshots prove the score discrepancy was unchanged by the release.

All **3,519** weekly season entries match independently accumulated Gross-plus-Net `event.season_points`, rounded to the schema’s cents. An independent in-memory season recomputation matches all **265** stored standings for totals, rank, previous rank, points behind, wins, and events played: season total **411,346.52**, **245** recorded wins. No score-fix-driven season delta is expected.

Precision qualification: 513 raw upstream combined weekly values contain fractions beyond two decimals; their stored cents differ from the raw sum by **+0.136** in aggregate. This is existing numeric-column quantization, not Gross/Net score contamination and not an exact-full-precision claim. The current previous-rank algorithm also follows numeric week ordering (including 101/102), not actual calendar ordering; this report verifies the existing algorithm rather than proposing a standings redesign. [Season numeric schema](https://github.com/libreninja/planit-golf/blob/c97d5d91b8cfe0f226d50da65a59177dcf9f2f21/supabase/migrations/20260731000000_baseline.sql#L1382)

## Read surfaces, current/live risk, and other events

- **Historical Weekly:** wrong Net total/to-par, holes, cumulative Net to-par, and Net-based ordering. Official labels and awards remain correct. Expanded cards can expose the wrong Net side even when the selected leaderboard is Gross.
- **Player Detail:** persisted Net totals/to-par/holes are affected. Gross-based form, averages, low round, and Gross hole comparisons are unaffected by this defect in the current Men’s data. Its **live overlay has the same sibling mistake**: it fetches both modes, chooses the Gross card first, and copies all fields. A persistence-only fix leaves live Net detail wrong. [Player live overlay](https://github.com/libreninja/planit-golf/blob/c97d5d91b8cfe0f226d50da65a59177dcf9f2f21/lib/players/data.ts#L351)
- **Weekly live API:** `/api/competition/live` and the compatibility IGC live route read the selected tournament independently, with mode-specific caching. Selected live Net values bypass this importer and are correct relative to that payload. A Gross live response’s embedded Net fields are still only Gross-context evidence. The legacy combined helper instead takes the entire Net card first, an opposite but equally unsupported cross-mode assumption. [Live service](https://github.com/libreninja/planit-golf/blob/c97d5d91b8cfe0f226d50da65a59177dcf9f2f21/lib/competition/live.ts#L128), [Legacy combined helper](https://github.com/libreninja/planit-golf/blob/c97d5d91b8cfe0f226d50da65a59177dcf9f2f21/lib/igc/weekly-results.ts#L533)
- **Next/current week:** Men’s Week 24 (September 22) has empty current Gross/Net results and no persisted performances. It is vulnerable on completion/import through cron, CLI, or on-demand reconciliation. PR40’s award-completeness checks do not validate score authority. Historical durable rows will not repair themselves simply because importer code changes.
- **Championship:** individual rounds 101/102 are affected. The aggregate Championship reader currently gets each selected-mode round directly from live results and computes aggregate ties/positions there; it does not derive those positions from the corrupted durable Net cards. [Aggregate reader](https://github.com/libreninja/planit-golf/blob/c97d5d91b8cfe0f226d50da65a59177dcf9f2f21/lib/competition/aggregate-reader.ts#L80)
- **Legacy statistics:** persisted Net birdie/double metrics are wrong. Legacy `flight` and `ranking_change` columns are not written by this importer; they are not derived from this defect. No downstream score-derived database rebuild/trigger was identified. The active season snapshot is distinct from legacy `igc_league_standings`.
- **Women’s League:** the same importer behavior is confirmed in **1,277 performances, 212 member IDs, all 17 resolved historical individual occurrences**. Each matches its Gross payload’s complete score facts while disagreeing with authoritative Net. Within that set, 1,096 birdie counts and 1,210 double counts differ. Of these performances, 1,175 have an existing matching Net result row; 102 are in Week 19, whose result rows are missing. Women’s has additional independent drift described below.
- **Other competition types:** league team/scramble shapes are excluded from individual import. Seattle Cup has a separate match/normalization/archive pipeline; there is no evidence this league importer corrupts those match records. Generic event management uses a separate `lib/igc/golfgenius-sync.ts` writer. Sharing a Golf Genius provider does not establish the same merge defect.

No live page/API was invoked for this investigation: those paths can write caches or reconcile on read. Read behavior above is established from production source and captured data, not a new production browser run.

## Separate findings that constrain a safe historical replay

**Men’s identity-key collision, Weeks 8 and 10.** Golf Genius publishes both `Smith, Scott M.` and `Smith, Scott` under member-card ID `3145962038740674495`, with different scores/awards. Both performances exist, but the result natural key can store only one row per member/mode. The four name/mode result memberships for Scott M. are absent; existing rows represent Scott. For example, Week 8 Scott M. Gross is 35 / T6 / 95 points; Scott Gross is 39 / T13 / 52.13 points. Week 10 Scott M. Net is 29 / T5 / 87.14 points / $1.43; Scott Net is 32 / unplaced. This is a separate identity/result-cardinality problem, not an effect of dropping Net scores. It prevents claiming the full historical result set is complete, despite zero discrepancies among stored result award rows. The normalizer also keys cards by member ID first, which can mask one duplicate card on replay. Do not merge these identities or replay those weeks blindly.

**Women’s additional discrepancies.** Beyond the 1,277 directly attributed Net cards, 22 more Net-total mismatches in Weeks 19/20 also disagree with Gross source and lifecycle facts; they are not explained solely by this merge branch. Across Women’s there are 424 existing result rows with placement and/or purse differences in Weeks 20–22; 210 source result memberships absent in Week 19; four stale result memberships in Week 20; and 112 performance name/identity keys absent from current source (22 each in Weeks 1,2,3,5,6, plus two in Week 20). Some are extra legacy/renamed records. Their provenance was not established and they require their own reviewed reconciliation, not inclusion in the Men’s score patch. Detailed row-level differences are in the evidence file.

## Smallest durable correction — proposal only

1. **Replace whole-card precedence with explicit source ownership.** Assemble Gross arrays/totals/to-par only from the Gross tournament and Net arrays/totals/to-par only from the Net tournament. Existing performance columns already represent both modes; no schema migration is needed for this correction. Keep mode-specific result/award rows separate and preserve the existing Net meaning of performance award copies. Missing authoritative mode stays unknown; a missing payload does not justify Gross-plus-handicap arithmetic or borrowing the other payload’s fields.
2. **Recompute both Net metrics after assembly**, using authoritative Net holes and verified course/par. Preserve Net metric semantics. Validate mode identity, hole shape, and lifecycle; explicitly reject ambiguous duplicate identities rather than silently pairing different people.
3. **Use the same ownership rule in live Player Detail and any retained combined-card reader.** Where a live response only fetches one mode, populate only facts that source establishes, or fetch the other mode before advertising its values. Preserve Gross values even if a future Net payload’s embedded Gross fields differ. This requires data/model work, not UI redesign.
4. **Add meaningful regression coverage before release:** paired payloads with independently different Gross/Net holes, totals, to-par and awards; Kevin Week22; adjusted-source occurrence; correct early week; zero/null scores; unplaced/tied positions; partial/withdrawn cards; missing mode; different flights/member sets; duplicate identity/name ambiguity; explicit 9-hole vs 18-hole total selection. Exercise the pure importer with recording writes and assert score ownership independently of the importer’s own expected-output generator. Verify unchanged award/season facts and live/durable agreement.
5. **Do not broaden the schema to raw-stroke modeling without separate evidence.** The correction stores authoritative result-mode facts. Supporting distinct raw and tournament-adjusted cards later would require explicit provenance/model work, not a renamed field in this patch.

## Exact Men’s backfill/rebuild plan after an approved fix

The saved [proposed manifest](/private/tmp/igc-net-investigation/proposed-mens-backfill.json) identifies **1,153 existing performance UUIDs and 6,220 changed field values**, with before/after values and both tournament source hashes. It is data only and has not been executed.

1. Freeze a reviewed source version and capture fresh before-images plus both current authoritative payloads for Weeks **17,18,19,20,21,22,23,101,102**. Check manifest source/state drift before writing; current evidence is a baseline, not permission to assume future state is unchanged.
2. Run the corrected pure assembler locally. Validate all Gross fields against Gross, all Net fields against Net, all awards by their own mode, and the exact expected row/field diff. Expected changed fields are **only** `net_scores`, `to_par_net`, `net_total`, `to_par_net_total`, `birdies`, and `double_bogeys`. Do not update already-correct fields solely to force a replay.
3. In one bounded, guarded operation, update those **1,153 performance rows** using before-image/version predicates and retain rollback images. Normal `updated_at` changes are expected. No inserts/deletes, name/identity changes, result award writes, season-entry writes, or broad durable-marker reset are required for this defect.
4. Re-read every changed row and compare to its authoritative mode source. Prove Gross score facts, awards, result memberships, and all unaffected occurrences remain unchanged. Invalidate only caches/read projections that actually contain changed derived cards; readers otherwise use the corrected durable row directly. Verify one representative historical Weekly scorecard and live Player Detail with the corrected model, plus source-payload regression coverage.
5. **Season rebuild:** recompute in memory and require **zero substantive delta** to the current 265-row standings snapshot. No physical season standings rebuild is logically necessary because points, placements/wins, and Gross participation are unchanged. No result-table or weekly season-entry backfill is required for this score defect. If operationally choosing full standard reconciliation, explicitly review its wider writes: 1,188 performances, 2,376 results, 1,187 existing weekly season entries in these occurrences, identity refreshes, timestamps/durable markers, and season snapshot replacement. That is broader than the smallest correction.
6. Leave Weeks 1–16, Week24, unrelated Women’s discrepancies, and the Smith identity collision outside this Men’s score backfill. A separately authorized Women’s remediation can use the 1,277 attributed-card list as a starting point, after resolving its additional stale/missing state.

Implementation and data correction would be **GUARDED** under [docs/DELIVERY.md](DELIVERY.md) because they change authoritative ingestion and historical data. **This investigation stops before implementation and production mutation.**
