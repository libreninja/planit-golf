# Men’s League discoverability + density QA

Real-data local previews captured from the isolated feature worktree at the
requested mobile viewport (390×844) and a 1440×1000 desktop viewport.

## Mobile previews

- `01-weekly-default-390x844.png` — default Weekly with search visible
- `02-weekly-name-search-390x844.png` — case-insensitive Hans Olson search
- `03-weekly-search-flight-390x844.png` — long-name search + Flight 2
- `04-weekly-search-favorites-390x844.png` — search + Favorites
- `05-weekly-no-results-390x844.png` — no-match state with Flight 2 preserved
- `06-season-390x844.png` — all five Season columns, no horizontal overflow
- `07-player-detail-inline-back-390x844.png` — long player name + inline return
- `08-performance-identity-back-star-390x844.png` — First Last identity, star,
  and inline return

## Desktop previews

- `09-weekly-hierarchy-controls-1440x1000.png` — compact hierarchy and controls
- `10-season-width-1440x1000.png` — 1120px standings table within the widened
  Men’s League container
- `11-performance-identity-back-1440x1000.png` — compact Performance identity
  and return navigation

The environment had no reusable smoke-test member credentials. Preview 04 uses
the real Week 22 rows and Hans Olson’s canonical golfer ID with a temporary
local signed-in follow-state fixture. The fixture was removed before tests,
build, diff review, and commit; it performed no follow write.

Automated geometry checks recorded search at y=143 on mobile, controls at y=195,
zero Season mobile overflow (`390px` scroll/client widths), and 20px inline
return controls with aligned arrow/text centers on Player Detail and Performance.
