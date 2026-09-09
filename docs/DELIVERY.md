# FAST and GUARDED delivery

This is the canonical detailed delivery policy for planit.golf. [AGENTS.md](../AGENTS.md) is the short execution contract.

## Operating model

FAST integration is the routine path. GUARDED integration is an explicit escalation for known risk or uncertain state; it is not the routine release checklist.

The normal lifecycle is:

1. The feature agent implements and verifies its exact final commit.
2. The same agent reports `READY FOR FAST INTEGRATION` using the block in `AGENTS.md`.
3. The user replies `fast integrate`.
4. The same agent fetches, runs deterministic preflight, squash-merges, waits for the GitHub-triggered Vercel deployment, performs a tiny production smoke, and cleans only its own feature worktree/branch.

A separate integration session is normally warranted only when the prior session is unavailable, recovery is needed, branch state is uncertain, or a GUARDED trigger exists.

`fast integrate` is a deployment command, not a request for another analysis. The agent uses the branch, source SHA, and base SHA already present in the READY report. It does not ask for them again, produce another plan, rerun tests, or start a broad audit. It runs preflight; FAST means merge/deploy now, while GUARDED means stop and report the exact trigger.

## FAST eligibility and verification lifetime

The eligibility conditions and required final-SHA checks are defined in `AGENTS.md`. Feature development owns all focused tests, unit tests, lint, build/typecheck, diff checks, and feature-specific visual/functional QA before READY.

FAST integration trusts that evidence while all of these remain true:

- source `HEAD` equals the READY source SHA
- source worktree is clean
- the reviewed feature diff is unchanged
- READY base/source ancestry remains valid
- main is unchanged or its advancement is deterministically independent
- expected merge content remains deterministic
- no new concern or trigger appears

Squash merge changes commit identity, not content validity. When main is unchanged and the merged-main tree equals the verified-source tree, prior verification still applies. Elapsed time, machine restart, or a different agent session does not by itself make verification stale.

## Deterministic preflight

From the source worktree:

```bash
pnpm integration:preflight -- \
  --source <branch> \
  --source-sha <ready-source-sha> \
  --base-sha <ready-base-sha>
```

Defaults:

- `--worktree`: current directory
- `--source`: detected current branch
- `--main-ref`: `origin/main`

The helper is read-only. It never runs verification, browser QA, merges, pushes, or repository cleanup. It reports source/base/main identity, cleanliness, ancestry, ahead/behind, source paths, main-advancement paths, overlap, guarded surfaces, conflict-free merge analysis, and expected-tree determinism. It ends with exactly one classification:

```text
FAST ELIGIBLE
```

or:

```text
FAST STOPPED — GUARDED TRIGGER: <specific trigger>
```

The helper detects repo-visible risk. READY authors remain responsible for non-code facts such as planned production mutation, unresolved QA concern, or stacked-branch dependency.

### Main advancement

When `origin/main` still equals the READY base, FAST continues.

Trivial advancement may remain FAST only if preflight proves quickly that the READY base is still an ancestor of main, source and main paths do not overlap, no sensitive/cross-cutting surface is involved, the synthetic merge is conflict-free, feature-owned blobs remain intact, and the composite is deterministic. The verified source commit stays unrevised.

Any material or uncertain advancement stops FAST. Examples include non-ancestral history, overlapping paths, guarded paths on either side, a conflict, or an uncertain composite tree. The agent reports the trigger and waits; it does not silently enter GUARDED mode.

## GUARDED triggers

Use GUARDED integration for any of the following:

- database migration or baseline change
- schema change
- seed, trigger, function, privilege, or extension change
- data backfill, transformation, or destructive mutation
- RLS policy change
- authentication, authorization, entitlement, or security-boundary change
- production identity linking, deduplication, or migration
- broad ingestion, reconciliation, or authoritative-data correctness change
- manual production mutation or cutover
- Vercel, environment, cron, or deployment-config change
- framework, runtime, package-manager, or build-pipeline change with deployment implications
- dirty or ambiguous worktree
- unknown source or base SHA
- verification not bound to the final source SHA
- missing or failed required verification
- diff outside the reviewed scope
- material main advancement
- merge conflict or uncertain composite tree
- unresolved stacked-branch dependency
- reboot or crash recovery with uncertain state
- unresolved QA or implementation concern

Path classification is deliberately narrow. The preflight helper recognizes current repo surfaces including Supabase migrations/schema/seed SQL, auth middleware and privileged Supabase clients, RLS/security SQL semantics, tracked Vercel/environment/cron configuration, runtime/package/build files, and the competition ingestion/reconciliation adapters and sync/archive scripts. If a changed sensitive path is inherently ambiguous, the correct result is a specific GUARDED path reason—not open-ended archaeology during FAST.

## GUARDED procedure

GUARDED work is proportionate to the identified risk:

1. State the exact risk.
2. Reconstruct or reconcile only the relevant state.
3. Define the expected tree or data mutation and the rollback boundary.
4. Run risk-specific validation.
5. Rerun broad tests only when the resulting code/state actually invalidates prior verification.
6. Merge.
7. Verify the risky production behavior.
8. Report the risk, evidence, and rollback posture.

GUARDED does not mean “rerun everything.” Do not begin this procedure automatically after a FAST stop; await user direction.

## Merge and deployment provenance

Push the already-verified source if needed, open or reuse a PR, and squash-merge. Production originates only from GitHub `main`; never use `vercel deploy` for production.

Wait for the exact merged main SHA through GitHub deployment records created by `vercel[bot]`:

```bash
pnpm integration:deployment -- <merged-main-sha>
```

The helper selects an exact-SHA `Production` deployment, reads its latest Vercel-authored status, and reports deployment ID, target, state, SHA match, URL, and `READY` or failure. It avoids incomplete Vercel CLI deployment listings.

## Production smoke and authentication

FAST smoke covers only:

1. Vercel READY for the merged SHA.
2. Exact deployed provenance.
3. One changed primary route responds.
4. One critical changed behavior works.
5. No obvious runtime or browser-console failure appears.

Broader feature QA belongs before READY.

If authenticated browser credentials/session are unavailable, do not hunt for credentials or retry login. When automated private-state coverage is green and auth/security semantics did not change, continue FAST and report `authenticated production smoke unavailable`. At most, request one tiny user-assisted workflow. Any auth/RLS/security semantic change is already GUARDED.

## Cleanup boundary

New worktrees use `.worktrees/<feature>`. After a successful delivery, the feature agent proves that merged main represents the intended source content, then removes only its known completed worktree and branch. It never inventories, moves, resets, stashes, cleans, or deletes unrelated worktrees or WIP. If proof is uncertain, retain the feature state and report it.

## Pull requests and repository settings

The PR template carries a short READY checklist without requiring a release essay. GitHub should retain the PR as provenance, allow squash merge as the only normal method, and delete the remote feature branch after merge. Do not add mandatory full-suite waiting or approval requirements solely for ceremony; preserve any meaningful protections that already exist.

## Timing target

- FAST agent work from `fast integrate` until the production deployment starts: under 60 seconds
- external GitHub/Vercel wait: variable
- FAST agent work after READY for smoke and cleanup: normally no more than two minutes

Agent investigation should not dominate routine delivery wall clock.
