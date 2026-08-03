# Integration tests (require local Supabase)
These are NOT unit tests. They need a running local Supabase and GG fixtures.

    pnpm supabase          # start local Supabase (applies migrations)
    node --test tests/integration/reconcile-idempotent.mjs
    node --test tests/integration/cache-cross-instance.mjs

The cache cross-instance test documents the BEST-EFFORT coalescing guarantee:
duplicate upstream fetches during simultaneous cold misses are permitted.
Strict cross-instance single-flight would require a Postgres advisory lock
(not implemented in this phase).
