# Player Detail V1 identity boundary

Player Detail V1 supports only the 2026 IGC Men's League. A Planit `golfers.id`
UUID is the durable route/follow target and has no dependency on `auth.users`.

Golf Genius `member_card_id` is stored as evidence in
`golfer_external_identities`, scoped to `igc-mens-2026`. It is not a Planit
primary key and is not assumed to survive another season. Event roster IDs and
display names are not used as identity keys.

The initial resolver uses these rules:

1. Consider only persisted 2026 Men's performance/result appearances with a
   non-null Golf Genius member card.
2. Resolve one scoped card to one new Planit golfer only when all observed
   exact normalized names for that card agree.
3. If a card has multiple exact normalized names, no name, or a generic guest
   label, retain the evidence row as unresolved and expose no player link.
4. Never join two scoped cards because their names match. If the same human has
   multiple cards, V1 intentionally under-merges rather than guessing.
5. Do not infer auth ownership from profile/member/display-name data. A
   `golfer_user_links` row must be established by trustworthy evidence before
   the UI renders “You” and prevents self-follow.

The finalized-round reconciliation path refreshes only the cards imported in
that round. A first-ever live appearance stays unlinked until durable evidence
exists; this is preferable to creating a public/followable identity from an
unresolved live name.

## Performance analysis boundary

`/players/[golferId]/performance` is the stable destination for deeper player
analysis. The landing page stays limited to selected-round and recent-form
questions plus a neutral Interbay entry point with the comparable-round count.
It exposes no ambient strengths, gaps, rankings, or comparator values. The
deeper page answers how the golfer plays each Interbay hole through explicit
`Vs Flight` and `Vs Field` lenses. Generic scoring-outcome distribution is not
part of the current product surface.

This is not a generic course analytics contract. The code-owned
`igc-mens-2026-interbay-back-2023-front-nine` manifest contains only occurrences
individually audited against Golf Genius. For every included occurrence:

1. The event is the 2026 IGC event `12263651301715371717`, whose course list
   contains The Links at Interbay (`10275121452864792250`).
2. Every tee-sheet player is assigned the same tee-sheet tee identity
   `10275121691537466950` (`Back 2023 - Men`).
3. Every group starts on Hole 1 and carries the same first-nine par sequence
   (`4,3,3,3,3,3,3,3,3`) and yardages
   (`288,153,95,102,130,186,164,124,130`).
4. The persisted occurrence must still match the exact audited GG event ID,
   round ID, date, individual format, finalized status, and Points Season name.
5. Each included scorecard must be completed over nine holes and its persisted
   gross plus gross-to-par facts must re-derive the audited par for every hole.

The audited set currently covers the 21 completed Points Season occurrences
from March 31 through September 1, 2026. Club Championship, incomplete cards,
team formats, upcoming rounds, and unaudited new occurrences fail closed. A new
week must be checked against the same source evidence and explicitly added to
the manifest; matching hole ordinals alone is never sufficient.

At the September 4 audit, authoritative tee-sheet counts and persisted
performance counts agreed for all 21 occurrences. There were 3,039 persisted
cards; 3,024 were completed nine-hole cards with nine finite gross facts and an
identical independently derived par sequence. The other 15 are excluded as
incomplete. GG exposes a separate course-catalog Back Men tee ID
(`10275121691336140357`) from the assigned nine-hole tee-sheet ID above. Planit
records both and keys this contract to the assigned tee evidence rather than
assuming those identifiers are interchangeable.

Both lenses use completed individual gross hole scores. For each completed
golfer start and hole, `Vs Field` compares the player's score with the average
of the *other* completed field cards from that exact occurrence. It is not a
generic season-wide field average. The displayed field average gives each of
the golfer's matched starts one benchmark observation.

`Vs Flight` resolves the target golfer's official flight independently for
every eligible occurrence. A card qualifies only when exactly one persisted
gross result and one persisted net result map to the same canonical
`Flight 1`, `Flight 2`, or `Flight 3` value for the exact occurrence, scoped
member card, and exact source player name. Missing, projected, ambiguous, or
gross/net-conflicting evidence fails closed. Peers must pass the same check and
match that occurrence's target flight. Flight therefore defines the cohort;
the scoring basis remains gross. No season-long flight is inferred.

At the September 4 flight audit, 3,022 of 3,024 completed comparable cards had
matching official gross and net flight memberships; all covered assignments
agreed. The two uncovered cards are the known shared-card/name ambiguity and
remain excluded from Flight. Eighty-two of 249 repeat name-consistent cards
appeared in multiple flights, confirming that a static season cohort would be
incorrect. Official membership was present in all 21 audited occurrences.

For both lenses, differential is player average minus the average of the
matched per-occurrence comparator benchmarks, and cumulative differential is
the sum of those per-start differences. Negative means lower gross scoring;
positive means higher. The UI calls this an occurrence-matched gross scoring
differential and does not give it a generalized professional-tour metric name.

One scoped Golf Genius card is known to contain two distinct names and scores
in the same occurrence. It remains unresolved as a canonical golfer. Its two
submitted cards remain separate field observations; performance analysis does
not merge or deduplicate people by display name or shared external card.
