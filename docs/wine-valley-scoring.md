# Wine Valley: native scoring and real Golf Genius synchronization

## Repository findings and implementation plan

Inspected current `origin/main` at `ea13d47` (also confirmed through GitHub's
main-commit API). Worktree: `.worktrees/wine-valley-scoring`; branch:
`feature/wine-valley-scoring`. Planit production data was not accessed. The
known Wine Valley GG event was inspected with GET requests after the user
supplied its ID; no upstream or production writes occurred.

| Existing concept | Authority and reuse decision |
| --- | --- |
| `event_series`, `event_editions` (`lib/events`) | Existing general event identity, dates, visibility, optional GG link. Use for Wine Valley. `/events/[seriesSlug]/[year]` exists, but its standings/pairings components are placeholders. |
| `event_participants` | Existing edition membership, currently requires `auth.users`. No application consumers/writers found. Add optional `golfer_id`, allow account-free membership, preserve existing account memberships and RLS. |
| `golfers`, external identities, user links (`lib/players`) | Canonical golfer UUID independent from an account. Match a roster row only by stable GG member-card identity, never by name. Reuse one unambiguous resolved golfer; otherwise create one canonical golfer and a private event roster reference. Existing public player analytics still require scoped Men's League evidence. |
| `events`, preferences, members/invites | Tee-time registration operations and legacy roster/account linking; not the multi-round event aggregate. Do not repurpose. |
| `igc_events/players/rounds/tee_times/pairings` | GG companion ingestion (`lib/igc/golfgenius-sync.ts`), external IDs required on children, public read policies. Local facts here could be overwritten by sync. Leave this bounded import model intact. |
| `igc_league_performances`, `igc_league_results` | Historical gross/net hole arrays and totals, separate gross/net placements; GG owns official facts. `reconcile/import.ts` refreshes and prunes source snapshots. Not a manual scoring writer. |
| `lib/competition` | Shared `HoleScore`, `Scorecard`, `ResultEntry`, deterministic multi-round aggregate arithmetic. Reuse projection types/arithmetic; registry/config and reconcile are currently GG-specific. |
| Seattle Cup | GG match/hole normalization, race/resolution projections, immutable archive; Planit owns the explicit playoff resolution. Useful separation precedent, not a gross stroke-play storage model. |
| Trips/Wine Valley | Legacy trip tables intentionally dropped by archived migration 020. No Wine Valley definition found in tracked current source/seed. The existing upstream trip has four rounds and a roster (inspection below). Future tenant/group epic is proposed architecture, not an implemented trip model. |
| APIs | Competition live/championship, IGC league, Seattle Cup, private activity/preferences/harvest. No general edition scoring API. Existing `assistant_proposals` are not a scoring record. |

The first committed slice established the scoring tables, atomic score writer,
and `readEvent`. The next slice adds `sync_event_from_golf_genius` and
`createGolfGeniusEventSyncService(...).syncSnapshot(...)`. The input is the
privacy-minimized real capture at `fixtures/wine-valley/2026.json`; the database
operation reconciles the whole event graph in one transaction.

New migrations and function privileges require GUARDED delivery. This session
only authors and locally verifies them; it does not apply anything remotely.

## Wine Valley upstream evidence

Direct GET inspection on September 10, 2026 of event `13048548030221936456`:
`/events/{id}/rounds`, each round's `/tee_sheet` and `/tournaments`, and
`/events/{id}/roster`. No event discovery was repeated. The roster has 33 entries.

| Round identity in GG | Date and tee times shown by GG | Tee-sheet participation | Main competition inclusion |
| --- | --- | --- | --- |
| `13048553133414835886` Friday AM Pre-Play | Sep 25, 7:30–8:00 AM | 12 across 4 groups | no |
| `13048553139957950127` Friday PM Round 1 | Sep 25, 12:30–1:30 PM | 28 across 7 groups | yes |
| `13048553145729312432` Saturday AM Round 2 | Sep 26, 8:30–9:40 AM | 32 assigned across 8 groups, plus 1 unassigned entry | yes |
| `13048553151567783601` Saturday PM Re-Play | Sep 26, 2:00–2:10 PM | 8 across 2 groups | no |

The inclusion column comes from the user's explicit trip definition, **not**
the upstream names or ordering. Tee-sheet presence does not by itself prove
membership in any particular GG tournament/side game. Round participation and
event membership are separate, and may differ again from competition eligibility.

All four rounds were `not started` with no populated hole scores at inspection.
Assigned tee data has this 18-hole par sequence:
`4,4,5,4,4,3,5,3,4,5,3,4,4,3,5,3,4,5`.
Saturday AM includes two tee identities; assigned tees agree on par. The
unassigned entry has no tee/time/starting hole and must not acquire invented data.

GG already defines gross/net two-day aggregate tournaments on the two main
rounds, Canadian skins, and a Stableford side game; replay rounds also have
side-game/no-purse tournament definitions. Preserve those definitions and GG's
official results. This slice's one gross aggregate is explicitly a primitive,
provisional projection; it is not a replacement for that tournament system.

The event endpoint reports Seattle, Washington as its location while the GG
course record is `Wine Valley Golf Club - 2025`; the edition uses the course
location/name rather than the apparently administrative event location. All
four round settings report `teesheet_released = false` even though the API
returns complete pairing groups. John Casey is the Saturday AM unassigned row:
GG supplies a player-round ID but no tee, tee time, or starting hole. The sync
therefore creates round participation with `groupId = null` and does not turn
GG's unassigned bucket into a published Planit group.

## Implemented boundary

```text
event_series → event_editions → event_participants → golfers
                    ↓                  ↑
                event_rounds → event_round_participants
                    ↓             ↓ optional tee-group assignment
             event_round_holes    event_round_groups

recordGrossScore → validated hole_score_revisions
                → shared Scorecard + explicitly included competition rounds

captured GG snapshot → sync_event_from_golf_genius
                     → same edition/participants/rounds/groups (reconciled)
                     ↛ event_hole_score_revisions (never touched)
```

The new tables are `event_rounds`, `event_round_holes`, `event_round_groups`,
`event_round_participants`, and `event_hole_score_revisions`. Existing account
participants remain valid; scoring participants must have an explicit golfer
identity and active player membership. Composite foreign keys prevent crossing
editions, rounds, or identities. Scores retain the golfer identity even if a
display name changes. Scored identities cannot be reassigned or cascaded away.
Round participation exists even before pairing; the group-scoped scoring
operation requires a matching assignment. Trip membership never enrolls a
person in a round automatically.

The sync persists GG event and portal IDs, event roster ID, member-card identity,
round ID, player-round ID, course ID, and published pairing-group ID. A stable
GG ID keeps the same Planit UUID across reruns. Groups and round memberships
missing from a later capture become source-inactive rather than being deleted,
so score provenance cannot be orphaned. A changed tee time or player grouping
updates current metadata in place. Canonical names are not overwritten by GG;
the source display-name snapshot remains separately available in `readEvent`.
Multiple canonical golfers already claiming one member-card ID stop the sync
with `P1005` instead of guessing.

`createEventScoringService(serviceClient)` exposes:

```ts
recordGrossScore({
  eventEditionId, roundId, groupId, participantId,
  hole: 1, gross: 3, expectedRevision: 0, requestId,
}, { actorRef: 'service:wine-valley-local-demo', source: 'manual' })
// → receipt: gross 3, previous_gross null, revision 1, identity/context,
//   request_id, actor_ref, source, database-generated recorded_at

recordGrossScore({
  eventEditionId, roundId, groupId, participantId,
  hole: 1, gross: 4, expectedRevision: 1, requestId: correctionRequestId,
}, { actorRef: 'service:wine-valley-local-demo', source: 'manual' })
// → receipt: gross 4, previous_gross 3, revision 2

readEvent(eventEditionId)
// → { edition, participants, rounds: [{ participations, holes, groups }], scores, standings }
// scores contains the latest revision per hole. Full history remains in DB.
```

UUIDs are required: a participant name or GG card cannot stand in for identity.
Revision zero means unscored. A new correction requires the revision most
recently read; a conflict is `P1002`. Invalid/closed context is `P1001`; reusing
a request ID for a different command is `P1003`; malformed input is `22023`.
An exact retry returns the original receipt even after another correction or
round closure. Use `readEvent` for current state. New writes require an active
edition, a round explicitly using `score_authority = 'planit'`, an open round,
eligible participant, matching tee group,
and a configured hole. Gross is an integer from 1–99, a product input bound,
not a handicap-adjusted maximum. Zero/missing is never a recorded score.

An edition can retain its real GG event reference while Planit owns a selected
round's scores. GG round/group references preserve the source identities of
imported scheduling facts. Neither reference implies score ownership. Inclusion
and authority have no database defaults: provisioning must choose them. Only
`counts_toward_competition = true` rounds feed the overall gross projection;
replay-only golfers remain visible in their own round cards. If an included
round is GG-owned, `standings.overall` is null and `unavailableRoundIds` names
the missing upstream score input. No native-only partial aggregate is presented.

All three RPCs return JSON and are service-role only. Direct score inserts, updates,
deletes and truncation are revoked even from the service role; the scoring
function is the sole application write path. A database owner can still perform
administrative SQL, as with existing schema. Actor/source are supplied by the
trusted application caller: they are provenance, not authorization credentials.
Future signed-link/auth adapters must verify authority and derive actor/source
before invoking this service. The participant adapter is now documented in [wine-valley-participant-scorecard.md](wine-valley-participant-scorecard.md).

The read RPC uses one SQL snapshot. It deliberately includes private operational
context and provenance; do not send it wholesale to a public route. Public event
visibility policies and existing GG consumers are unchanged. No model/Seve code
is imported by the service or database operation.

## Demonstrated result and verification

The real, privacy-minimized capture imports one invite-only 2026 edition with 33
account-free participants, four 18-hole rounds, 21 published groups and 81
round-participation rows. The round shape is:

| Planit purpose | GG round | Participants | Published groups | Competition | Score authority |
| --- | --- | ---: | ---: | --- | --- |
| replay | Friday AM Pre-Play | 12 | 4 | no | Planit |
| competition | Friday PM Round 1 | 28 | 7 | yes | Planit |
| competition | Saturday AM Round 2 | 33 (32 paired, 1 unassigned) | 8 | yes | Planit |
| replay | Saturday PM Re-Play | 8 | 2 | no | Planit |

Round participation is not inferred from trip membership. For example, Landree
Bower appears only in Saturday AM, while other golfers play two, three or four
rounds. The test variant also proves a replay-only participant remains on that
round's scorecards while never entering overall competition standings.

The local scoring demonstration selects GG group `13048595300564887052`, the
real Friday PM 12:30 PM foursome. It records Josh Benner hole 1 gross 3 through
`recordGrossScore`, reads the score alongside the canonical golfer, source
roster/member-card/player-round references, round, group, tee time, starting
hole and par, reruns the complete GG metadata sync, and reads back the identical
revision-one score receipt. No score is sent to GG and the sync function never
inserts, updates, or deletes `event_hole_score_revisions`.

The original synthetic fixture remains for lower-level scoring behavior. It has
six account-free golfers and four nine-hole rounds following the same purpose
sequence. Four golfers play all four rounds, Amelia plays both replays, and
Taylor only the first replay.

| Hole 1 | Current gross | To par | Revision history |
| --- | --- | --- | --- |
| Bob | 4 | E | 3 → 4, both attributed and timestamped |
| Tom | 5 | +1 | 5 |
| Luke / Jamie | unscored | unknown | none |

Three persisted facts produce two current scores. Retrying Bob's first command
does not undo his correction. A stale correction fails without adding a fact.
Concurrent first scores/corrections produce exactly one winner. A second-round
score is independent of round one, and both roll up without merging hole arrays.
Recording replay scores for Bob, Amelia and Taylor leaves the main competition
standings unchanged. A replay-only golfer cannot record a main-round score.

Verification includes 23 focused tests (7 unit + 16 real PostgreSQL scenarios).
The seven real-capture sync scenarios cover idempotency, existing canonical
matching, unmatched golfer creation, round-specific participation, honest
unassigned representation, replay-only standings exclusion, changed grouping/
tee time reconciliation, real-group scoring, score preservation across resync,
and private service-only roster references. Broader verification results are
recorded in the final delivery report.
- Functional QA is the reproducible service/database flow. No UI was changed.
  The test transport calls the actual SQL RPC functions as `service_role` via
  psql; this does not exercise a deployed PostgREST or HTTP endpoint.

To reproduce from this worktree, start the dedicated disposable database (uses
the already-installed image, no network, ports, production credentials or
existing Supabase container). Do not reuse another session's database:

```bash
docker run --detach --rm --name planit-wine-valley-scoring-test \
  --network none --tmpfs /var/lib/postgresql/data --entrypoint /bin/bash \
  public.ecr.aws/supabase/postgres:17.6.1.063 -lc \
  'install -d -o postgres -g postgres /var/lib/postgresql/data && su postgres -c "initdb -D /var/lib/postgresql/data --auth=trust" && exec su postgres -c "postgres -D /var/lib/postgresql/data -c listen_addresses= -c unix_socket_directories=/tmp"'
docker exec planit-wine-valley-scoring-test pg_isready -h /tmp -U postgres
node --test tests/event-scoring.test.ts tests/integration/event-scoring.test.ts \
  tests/integration/wine-valley-sync.test.ts
docker stop planit-wine-valley-scoring-test
```

Wait for `pg_isready` to report accepting connections before running tests.
Each run creates/removes its own randomly named database, provides minimal
Supabase auth/role contracts, and applies every actual Planit migration. It
never loads `.env.local` or accepts a remote database URL. The container is
ephemeral and is removed when stopped.

## Deliberate limits and next session

- The checked-in capture is a deterministic, PII-minimized import source, not a
  scheduler or background poller. Refreshing it from GG still requires the same
  read-only capture step; there is no organizer button or cron job.
- Gross individual stroke play only. No net handicaps, pickups, score clearing,
  team formats, official finalization or tie-break policy. Rankings are always
  provisional, including when players have different amounts of golf recorded.
- One explicitly selected gross competition round set, not a multi-tournament
  engine. GG side games, handicaps, tees/yardages and per-tournament eligibility
  remain upstream. This import marks participation in the two designated main
  rounds as locally competition-eligible; tournament-specific exceptions need
  an explicit future rule rather than inference from a tee sheet.
- One player/hole per operation. A future multi-player utterance needs an
  explicit batch/confirmation decision before claiming all-or-nothing behavior.
- The current scorecard context carries round par and starting hole, but not
  tee-specific yardage, handicap dots or tournament definitions. Whole-event
  reads are appropriate for this trip size, not a high-volume league results API.
- Canonical `golfers` names already have public read policies. Private event
  membership is not exposed here, but roster provisioning must account for that
  existing name-visibility policy. Never auto-link same-name golfers or accounts.
- Existing GG official-result authority remains intact. All four Wine Valley
  rounds explicitly use Planit score authority for future locally recorded gross
  scores; this does not migrate, overwrite or publish GG tournament results.

The participant scorecard slice is implemented and locally demonstrated in
[wine-valley-participant-scorecard.md](wine-valley-participant-scorecard.md).
The next session is its narrow GUARDED staging rehearsal on a real phone.

Delivery remains GUARDED because of the participant/schema and function-grant
changes. Apply the migration only after approval. Roll back application exposure
first if needed; preserve score facts. Reverting participant nullability after
account-free participants exist requires a separate data decision, not an
automatic down migration.
