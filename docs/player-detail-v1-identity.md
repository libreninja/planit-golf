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
questions; distributions and future comparison analysis belong here.

Hole-relative league comparison is intentionally deferred. The current
performance rows persist hole array positions and derivable par, but not a
stable course, tee, and hole identity for every occurrence. Before comparing a
golfer to the league, Planit must establish that comparison key and define the
eligible cohort as completed 2026 Men's League individual rounds played from
the same course/tee setup. The first metric should be the transparent
player-average minus league-average score for each comparable hole, labeled
“vs league”; it must not be called Strokes Gained.
