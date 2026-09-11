# Wine Valley participant scorecard

Implemented only in `.worktrees/wine-valley-scoring`, on
`feature/wine-valley-scoring`, following commits `4b378c9` and `800f639c`.
No production or Golf Genius writes. Deployment requires **GUARDED** delivery:
this adds a capability table and authorization/function privileges.

## Access and participant interaction

`https://<host>/scorecard#<opaque-256-bit-token>` opens the assigned group with
no account or login. This is an opaque scoped capability, not a signed JWT.
The fragment is exchanged through `POST /api/scorecard/access` and removed
from the address bar. The server sets an HttpOnly, SameSite=Strict session
cookie scoped to `/api/scorecard`; production cookies are Secure. The fragment
never appears in the initial HTTP URL. Neither the server nor database stores
the raw token; the browser needs the session cookie. Trusted issuance returns
the secret once; the local harness alone retains it in a mode-0600 temporary
file so the test link can be reopened.

A row in `event_scorecard_access` fixes the edition, round and group. Only the
SHA-256 digest persists. Every read and write checks expiry, revocation, active
context and current group membership server-side. There is no client-selected
scope extension. Revocation waits for already-authorized transactions; once it
returns, new reads, writes and idempotent retries fail. Round closure or inactive
upstream group/round also disables the link. Scope is immutable through the
service role: reissue rather than update it. Issuance is restricted to Wine Valley.

The small mobile page reuses existing Planit colors, Fraunces/Inter typography,
rounded cards and large touch targets. It shows one hole, par, four real names,
saved values, previous/next and completion. Save & Next records only entered
scores. Empty players remain unscored; clearing an input does not delete an
existing score. Scores save individually, not as an atomic foursome batch.
Successful earlier writes remain acknowledged if a later player fails. Network
failures keep unsaved values and request IDs. A revision conflict retains the
entry, asks the participant to review latest scores, then requires another Save
to confirm the correction. Navigation retains drafts; leaving a page with drafts
uses the browser's unsaved-change prompt. No offline outbox is implemented.

## Service boundary

```text
fragment → POST /api/scorecard/access → checked group + HttpOnly cookie
cookie → GET /api/scorecard → read_participant_scorecard → group-only DTO
cookie + score command → POST /api/scorecard
  → createParticipantScorecardService.recordGrossScore
  → createEventScoringService.recordGrossScore
  → record_participant_gross_score (scope + membership + revocation lock)
  → existing record_event_gross_score (sole deterministic score writer)
```

The original trusted service callers retain the same operation. A future Seve
caller can supply its own verified authority and structured score command to
this deterministic boundary without emulating browser interactions. No voice,
AI abstraction, messaging, standings or event navigation was added.

The HTTP body is strictly limited to `eventEditionId`, `roundId`, `groupId`,
`participantId`, `hole`, `gross`, `expectedRevision`, `requestId`. The server
rejects injected actor/source fields, malformed/coercible values and bodies over
2 KiB. Browser writes require same-origin JSON. SQL independently rejects wrong
scope and derives `actor_ref = scorecard:<non-secret-access-id>`, `source = manual`.
Reads expose only group names, hole context and current scores/revisions, not
other groups, roster/member-card references, account identities or capability
metadata. API errors omit SQL details. Responses disable caching/referrers;
the page disables indexing and framing. No service-role or GG credential reaches
the browser. Public database roles cannot invoke these RPCs or read capabilities.

## Reproducible local real-group demonstration

Start the disposable, network-disabled PostgreSQL container using the command
in [wine-valley-scoring.md](wine-valley-scoring.md). Then run from this worktree:

```bash
node --test tests/event-scoring.test.ts tests/participant-scorecard.test.ts \
  tests/integration/event-scoring.test.ts tests/integration/wine-valley-sync.test.ts \
  tests/integration/participant-scorecard.test.ts
node scripts/wine-valley-scorecard-demo.ts
```

The demo applies actual migrations to a fresh randomly named database and imports
the existing real capture. Its loopback RPC bridge replaces **only PostgREST**;
the page, Next HTTP handlers, Supabase client, service and PostgreSQL functions
are real. The bridge accepts only two scoring RPCs, requires a random local key,
and accepts no remote database target. Next runs on port 4318; the bridge runs
on loopback port 4319. No environment files are sourced by the harness, and both
Supabase keys/URL passed to Next are explicitly local. Production and GG are not
used by this flow.

Open the URL in `/private/tmp/wine-valley-scorecard/access.json`. The demo link
expires after 24 hours. A phone on the same trusted LAN can replace `localhost`
with this Mac's LAN address; this temporary HTTP demo uses only disposable data.
Actual event access must use HTTPS. Mobile automated QA uses a 390px browser;
it is not evidence of testing on a physical phone.

In another terminal:

```bash
node scripts/wine-valley-scorecard-qa.mjs
```

The demonstrated group is Friday PM, 12:30 PM, GG `13048595300564887052`:
Bill Gustaveson, Darrell Mirsky, Josh Benner and Sean Dowling. The browser:

1. Exchanges the link and displays exactly these four players, hole 1 / par 4.
2. Enters Josh gross 3; saves, reloads and reads persisted revision 1.
3. Corrects to 4; reads revision 2 with three other players still unscored.
4. Simulates another scorer's 5 / revision 3; the phone's stale 6 is rejected.
5. Reviews the current 5, retains the entered 6, explicitly saves revision 4.
6. Proves alternate group/round/player requests return 403, injected actor 400,
   cross-origin mutation 403, and missing access 401.
7. Aborts a save's network request, retains the input and successfully retries.

Type `evidence` in the demo terminal to capture durable revision history. The
records include previous gross, revision, capability actor, manual source and
database timestamps. Type `revoke`, then run:

```bash
node scripts/wine-valley-scorecard-revoked-qa.mjs
```

Reopening the original link displays the unavailable state. Both reads and writes
with its previously issued cookie return 401. Type `renew` to get a new link for
the **same group**, retaining score history; type `quit` to discard this demo's
database. No other database/worktree is cleaned. Evidence JSON and mobile PNGs
are written under `/private/tmp/wine-valley-scorecard/`; only `access.json`
contains a raw local test token and must not be committed.

## Files and verification

- `app/scorecard/{page,participant-card}.tsx`: direct mobile artifact.
- `app/api/scorecard/route.ts`, `app/api/scorecard/access/route.ts`: HTTP adapters.
- `lib/events/participant-scorecard.ts`, `participant-http.ts`: issuance,
  revocation, curated reads, score adapter, bounded HTTP/errors.
- `lib/events/scoring.ts`: capability-aware delegation through recordGrossScore.
- `supabase/migrations/20260912000000_participant_scorecards.sql`: locked
  authorization, capability storage and service-only RPCs.
- `proxy.ts`, `app/layout.tsx`, `components/app-shell/app-shell.tsx`: omit optional
  account resolution/navigation on this standalone route; add privacy headers.
- `tests/participant-scorecard.test.ts`, `tests/integration/participant-scorecard.test.ts`,
  `tests/helpers/participant-db.ts`: HTTP protections and nine real-DB scenarios.
- `scripts/wine-valley-scorecard-{demo.ts,qa.mjs,revoked-qa.mjs}`: local demo and
  real browser checks. This document records the boundary and reproduction.

Focused tests cover valid, invalid, expired and revoked links; scope tampering;
client authority injection; entry/correction/reload/partial card; idempotent retry;
stale/concurrent writes; inactive membership; public-role privileges. Broad
checks are unit tests, lint, production build (including Next's TypeScript check),
and diff check. An extra standalone `tsc --noEmit` identifies existing typing
errors in untouched `competition-import-parity`, `competition-import-season-points`
and `seattle-cup-harvest` test files; the normal production build passes. Those
files are unchanged from `800f639c`.

## Limits, safe event use and next session

- A bearer link can be forwarded; it identifies a scoring capability, not which
  human held the phone. Everyone holding it can correct the current group's
  scores. It never grants another group/round, even if the organizer later moves
  a player. Expiry/revocation are database-enforced, not UI conventions.
- One active scorecard cookie per browser profile. Opening a different valid link
  replaces it. An older tab cannot write across the new scope; it gets rejected.
- No individual-token rate limiter, organizer issuance UI, delivery mechanism,
  offline queue, score deletion or atomic multi-player save. No tokens or scores
  are sent to GG. The local bridge is test infrastructure, not a production mode.
- Deployment, application of the three branch migrations, private real-event
  provisioning and link issuance remain undone and require GUARDED delivery.
  Real Supabase/PostgREST transport and HTTPS/device behavior must be verified in
  an isolated hosted environment before live Wine Valley use. Do not deploy the
  demo bridge or treat synthetic test scores as event facts.

Best next session: a tightly scoped GUARDED staging rehearsal using real
Supabase/PostgREST and HTTPS on an actual phone, including organizer issuance,
revocation and round/group assignment checks. No additional product surface is
needed to conduct that rehearsal.
