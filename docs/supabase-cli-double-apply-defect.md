# Supabase CLI local double-apply defect (machine-specific)

> Status: documented, NOT a blocker for the migration-history cleanup. The SQL
> migration chain itself is verified by single application against a blank
> database (see `docs/migration-baseline-verification.md`).

Canonical `supabase start` / `supabase db reset --local` verification is blocked
on this machine by a reproducible local Supabase CLI double-apply defect: the
CLI's Go migration runner applies **every** migration **twice** to the local
database.

## Evidence

A minimal probe migration applied on a freshly-pruned blank local DB:

```sql
CREATE TABLE IF NOT EXISTS public._apply_count_probe (id int);
INSERT INTO public._apply_count_probe VALUES (1);
```

`supabase start` failed with:

```
duplicate key value violates unique constraint "schema_migrations_pkey"
Key (version)=(20260731000000) already exists.
At statement: 2
INSERT INTO supabase_migrations.schema_migrations(version, name, statements) ...
```

That is the signature of a double-apply: pass 1 creates the table, inserts the
row, and inserts the ledger row; pass 2 re-runs the statements and the ledger
`INSERT` collides on the version PK. For a non-idempotent `CREATE TABLE`, pass 2
fails earlier with `relation "..." already exists`.

## What it is not

- Not the migration SQL — `psql -f` of the baseline against a blank DB applies
  cleanly once (45+ tables, exit 0).
- Not the project link — reproduces unlinked (`.temp/project-ref` removed).
- Not `config.toml` — reproduces with and without it (it was absent originally).
- Not the filename prefix — reproduces with `0000_` and with 14-digit timestamp.
- Not the container init — the migration file is never present inside the db
  container (only the data volume + pgsodium key are mounted), and an
  empty-migrations `start` leaves 0 public tables.

## Scope of reproduction

- Supabase CLI **2.84.4** and **2.111.0** — both double-apply.
- `supabase start` and `supabase db reset --local` — both double-apply.

## Workaround used for verification

Apply the canonical migration files **once** to a blank local Supabase DB via
`psql` (deterministic, single application), bypassing the CLI runner. This is
what the schema verification in `docs/migration-baseline-verification.md` uses.

## Resolution

This tooling defect is not part of the migration-history repair and does not
block it. It should be investigated separately (likely a stale local
Docker/Supabase state issue on this machine — e.g. a full `docker` /
`~/.supabase` / volumes reset, or a CLI reinstall). The `supabase` devDependency
was briefly bumped to 2.111.0 while chasing this and has been **reverted** to
2.84.4; `scripts/run-supabase.mjs` is unchanged from its pre-chase state.