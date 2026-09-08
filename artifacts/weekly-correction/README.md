# Weekly correction visual QA

Captured against the local production code path with the real read-only 2026 IGC data on 2026-09-08.

- `live-weekly-favorites-off-390x844.png`
- `live-weekly-favorites-on-390x844.png`
- `final-weekly-favorites-on-390x844.png`
- `followed-scheduled-tee-time-390x844.png`
- `player-detail-to-performance-pending-390x844.png`
- `performance-vs-field-pending-390x844.png`
- `weekly-gross-net-pending-390x844.png`
- `upcoming-weekly-390x844.png`
- `live-weekly-desktop-1440x1000.png`

The environment did not provide smoke-account credentials or a reusable signed-in browser session. Favorites screenshots therefore use a temporary local-only deterministic follow-state fixture (removed before verification and commit); they are not authenticated production verification.

No `not playing this week` screenshot was manufactured: the published Week 22 tee sheet contained every current leaderboard participant. The authoritative-absence behavior is covered by the participation unit tests.
