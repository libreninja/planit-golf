# Seattle Cup historical archive contract

Planit generates and owns the immutable historical record for completed Seattle Cup editions. The canonical 2026 artifact is [`data/seattle-cup/archive/2026.json`](../data/seattle-cup/archive/2026.json), identified as `seattle-cup:2026` and protected by its embedded SHA-256 integrity value.

`pnpm archive:seattle-cup -- --output <new-path>` fetches all four normalized round responses and validates the edition before writing. Generation fails unless the archive has the complete match schedule, awarded results, hole records, identities, final standings, champion, race state, and tournament resolution. The writer uses create-only semantics and will not overwrite an existing artifact.

The checked-in, versioned JSON artifact is the current canonical archive mechanism. Public history and other downstream consumers should eventually read this contract instead of reconstructing completed editions from mutable Golf Genius or live snapshots. Database-backed archive persistence may be added later as an operational choice; it is not required by, or part of, the current architecture.

Raw R3/R4 files under `fixtures/seattle-cup/raw/` are bounded forensic/test evidence for reproducing final normalization diagnostics. They are not the public historical contract.
