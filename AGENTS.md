# Planit delivery contract

FAST integration is the default. GUARDED integration is an explicit escalation path. Read [docs/DELIVERY.md](docs/DELIVERY.md) for the complete trigger and recovery policy.

When the user says `fast integrate` after a READY report, begin delivery immediately in the same session: do not ask for the branch or SHA again, produce another plan, rerun verification, or start a broad audit. Either merge/deploy under FAST or stop with the exact GUARDED trigger.

New feature worktrees belong under `.worktrees/<feature>`.

## FAST is default

A feature is FAST-eligible when:

- final committed source SHA is known
- READY base SHA is known
- source worktree is completely clean
- exact final source SHA has already passed required verification
- branch is not behind READY base/main
- reviewed feature diff is unchanged
- no unresolved implementation/QA concern exists
- no GUARDED trigger applies

Required final-SHA verification before READY:

- focused tests
- `pnpm test:unit`
- `pnpm lint`
- `pnpm build`
- `git diff --check`
- required visual/functional QA for the feature

These checks happen during feature development. Normal FAST integration does not rerun them.

## READY contract

Report exactly this concise block; no large narrative is required:

```text
READY FOR FAST INTEGRATION

Source: <branch>@<source-sha>
Base: origin/main@<base-sha>
Worktree: clean
Ahead/behind: <ahead>/0

Verified on exact source SHA:
- focused: pass
- unit: pass
- lint: pass
- build/typecheck: pass
- diff check: pass
- visual/functional QA: pass

Guarded triggers:
- migration/schema/data: no
- auth/RLS/security: no
- deployment/manual-production mutation: no
- unresolved concerns: no

Production-only check: <none | one narrowly stated check>
```

## FAST procedure

After `fast integrate`:

1. Fetch `origin`.
2. Confirm the source worktree is still clean.
3. Confirm `HEAD` still equals the READY source SHA.
4. Confirm the `origin/main` relationship to the READY base.
5. Run `pnpm integration:preflight -- --source-sha <sha> --base-sha <sha>`.
6. If still FAST, push the source if needed, open or reuse its PR, and squash-merge immediately so the GitHub `main` production deployment begins.
7. Run `pnpm integration:deployment -- <merged-main-sha>` and wait for exact-SHA Vercel Production READY provenance.
8. Perform the minimal changed-surface production smoke.
9. Prove merged tree/content representation, then remove only this completed feature branch/worktree when safe.
10. Report concisely.

Routine FAST integration does not rerun focused tests, the full unit suite, lint, a local build, visual QA, screenshot matrices, broad smoke suites, or unrelated worktree inventories while exact-SHA verification remains valid.

## Tree equivalence

When main has not advanced and:

```text
tree(merged-main) == tree(verified-source)
```

verification remains valid. A squash-created commit ID does not require retesting.

Verification becomes stale only when the source SHA changed, the worktree became dirty, the feature diff changed, verification was not performed on the final SHA, main advancement is material, the expected merge tree differs, or a new GUARDED concern appears. Time passing and session changes do not invalidate verification.

## Main advancement

### Main unchanged

FAST continues immediately.

### Trivial, provably independent advancement

FAST may continue only when deterministic preflight quickly proves:

- READY base remains an ancestor of main
- changed paths do not overlap
- guarded or cross-cutting paths do not overlap
- the merge tree is conflict-free
- feature-owned blobs remain intact
- the expected composite tree is deterministic

Keep the verified source commit intact; do not rebase merely to tidy history.

### Material or uncertain advancement

Stop and report:

```text
FAST STOPPED — GUARDED TRIGGER: material main advancement
```

Do not begin GUARDED work automatically.

## Post-deploy smoke

FAST production smoke is intentionally tiny:

1. Vercel is READY.
2. Deployed provenance matches merged main SHA.
3. The changed primary route responds.
4. One critical changed behavior works.
5. There is no obvious runtime or console failure.

Feature QA belongs before READY; FAST does not repeat exhaustive feature QA after deployment.

### Auth smoke

When authenticated production browser credentials/session are unavailable:

- do not hunt for credentials or retry login repeatedly
- do not block FAST when automated private-state tests are green and auth/security semantics did not change
- report `authenticated production smoke unavailable`

An optional user-assisted check is at most one tiny workflow. Auth/RLS/security semantic changes are GUARDED.

## Cleanup

Clean only the current feature agent's known branch/worktree. Prove the merged tree/content representation, remove that worktree/branch when safe, and leave unrelated WIP untouched. When safety is uncertain, retain it and report why.

## Concise completion report

The normal entire report is:

```text
FAST INTEGRATION COMPLETE

- Source: <branch>@<source-sha>
- Main: <merged-main-sha>
- PR: #<number>
- Deploy: READY (<deployed-sha>)
- Smoke: <route> + <critical behavior> passed
- Cleanup: complete
```

Optional exception:

```text
- Exception: authenticated production smoke unavailable; automated coverage green
```

Target timing: agent work from `fast integrate` until deployment starts is under 60 seconds; external GitHub/Vercel wait is variable; post-READY smoke and cleanup agent work is normally at most two minutes.
