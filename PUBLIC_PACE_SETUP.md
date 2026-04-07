# Public Pace QR Setup

This adds a public, unauthenticated QR flow without exposing private member pages or Supabase table access from the browser.

## Data model

Run migration `011_public_pace_scans.sql`. It creates:

- `public_pace_checkpoints`: QR destinations, seeded with `interbay-checkpoint-1` and `interbay-checkpoint-2`.
- `public_pace_scans`: confirmed scan timestamps. RLS is enabled with no public policies; server code writes with the service role.

## Runtime requirements

The scan page resolves the live foursome list when the QR is scanned:

- `GOLF_GENIUS_API_KEY` must be set.
- `GOLF_GENIUS_BASE_URL` can be set, otherwise it defaults to `https://www.golfgenius.com`.
- The active `events` row must have `golf_event_id` and `golf_round_id`.
- The checkpoint `league` can be `mens`, `womens`, or `NULL` for the next active event.

## Public routes

- `/scan/[token]`: public group confirmation and timestamp recording.
- `/leaderboard`: public leaderboard from recorded scans.

The existing `/` member surface still redirects unauthenticated users to `/login`.

## QR generation

Edit `scripts/qr-codes/public-pace-checkpoints.json` if checkpoint labels or tokens change, then run:

```sh
PUBLIC_SITE_URL=https://planit.golf npm run generate:public-pace-qr
```

Generated files:

- `public/qr/interbay-checkpoint-1.svg`
- `public/qr/interbay-checkpoint-2.svg`
- `public/qr/public-pace-checkpoints.html`

Share the SVG files or the printable HTML sheet with the member who is printing the signs.
