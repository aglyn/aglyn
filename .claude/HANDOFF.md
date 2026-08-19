# HANDOFF — 2026-08-19. **`main` is 289 ahead of production and NOT yet promoted.**

## State

- `production` = **`4773992d6`**, tag `v1.0.0-beta.2`. Unchanged today.
- `main` = **289 commits ahead**, ~200 Linear issues. Nothing promoted this session.
- Feature freeze **Aug 25**, launch **Sept 1**.

## The promotion blocker is CLEARED — and it was an absence, not a red

`console:test` **could not produce a verdict** for weeks. One spec hung forever
(`site-member-reversal-label.spec.tsx`): a `jest.mock` returning
`useFirestore: () => ({})` — a **new object per call** — against a hook whose
effect deps include it. Render → effect → setState → new `{}` → forever. An
infinite **microtask** loop, so jest's real-timer `testTimeout` can never fire
(150s elapsed against a 30s timeout). The AGL-2105 shape, second occurrence.

Fixed (`947100c2c`). **Two independent agents then measured the same number** at
`96fe2d2a6`, clean pinned worktree, quiet machine:

```
Test Suites: 3 skipped, 437 passed, 437 of 440
Tests:       10 skipped, 4809 passed, 4819 total   JEST_EXIT=0
```

That spec's commit is **already on `production`**, so the gate that cut
`v1.0.0-beta.2` did not read `console:test` either.

## ⚑ The gate had FOUR blind spots. All were "a check exists and nobody reads it"

1. **`console:test` never finished** (above).
2. **`console:lint` was red at 441 errors across 364 files** — invisible because nx's
   summary is truncated and prints no error text. Always count from
   `npx eslint --format json`. Cause: one `require('@aglyn/…')` inside a
   `jest.mock` factory marks the library lazy-loaded and reddens every static
   import of it. **4th occurrence** — now guarded by `aglyn/no-dynamic-first-party-import`.
3. **`npm run typecheck` was never run** by the gate that cut the tag — a typecheck
   error is red at `origin/production` itself.
4. **`apps/docs` runs its OWN `tsc`** and is not covered by `npm run typecheck`. Its
   config was invalid since 2026-07-24 (an nx migration wrote
   `ignoreDeprecations: "6.0"` into an app pinned to TS 5.6.3), so it type-checked
   **nothing for four weeks** — and hid a real error (AGL-2363).

⛔ **A cleared nx graph cache is a FALSE GREEN**: `@nx/enforce-module-boundaries`
prints *"No cached ProjectGraph is available. The rule will be skipped"* as a
**warning** and reports zero errors. Regenerate the graph and assert that warning
is ABSENT.

**Checks that exist and NOTHING runs** (AGL-2379/2376/2377): `check:legal-drift`
(**currently RED — 9 of 11 legal documents differ from their masters**),
`check:provider-key-exposure` (a security control), 17 backfill tests, and **five
`cloud/*.spec.mjs` rules specs with zero references repo-wide — one edited the day
before**. Five libs are **red by construction** (`test` target, no test files,
`passWithNoTests` set nowhere).

**CI answers ~1 commit in 8** (AGL-2378): 26 cancelled / 4 success for Tools guards
in one hour. `nx-ci.yml` had **no `timeout-minutes`** — the only workflow without
one — so the hang burned GitHub's 6-hour default and later pushes queued behind it.
**A green CI history is not evidence `main` was ever green.**

## ⚑ FIVE shared-checkout hazards, all found today

The checkout is shared by ~10 concurrent agents. Every one of these caused real damage:

1. **`git commit --only` does NOT exclude paths staged as ADDITIONS**, and this
   environment **auto-stages new files**. A commit naming 5 paths committed 7.
2. **`git commit --amend` takes the shared index** — an amend run only to fix a
   commit message dropped its own files and swept in five other agents', two as
   deletions.
3. **`git stash` is PER-REPOSITORY, not per-worktree** — a stash from a worktree
   landed on a stack holding five other sessions' entries.
4. **Blanket find-and-replace** rewrote other agents' committed `AGL-` citations to
   unrelated issues — invisible to tests, lint and typecheck, permanent once committed.
5. **`git checkout --`** on a file the agent had not authored reverted another
   agent's work out from under them.

**The recipe:**
```bash
GIT_INDEX_FILE=$(mktemp) sh -c 'git read-tree HEAD; git add -- <paths>; git commit -m "..."'
git diff --quiet HEAD -- <paths> && git add -- <paths>   # else they show as staged reverts
```

## ⚑ Measure in a PINNED WORKTREE, never the shared checkout

The tree carries ~30 other agents' uncommitted files, so any number from it is a
**superset**. I read `134/138` typecheck locally and `origin/main` was **clean** —
the break was an agent's work-in-progress.

**Load discipline:** four **orphaned** jest workers (ppid 1, ~3.5 GB each, one at
107% CPU for 1h39m) drove the box to **load 190** and manufactured SIGTERM
"failures". Three agents retracted failure counts over this. Killing them dropped
load to 21. Check `ps -eo pid,ppid,args | grep jest | awk '$2==1'` before and after
any run, and check `uptime` before calling anything a flake.

## The root cause behind most of today's backlog

> **Three separate correct changes were each verified against a scope their author
> chose, and each pushed `main` red.**

AGL-2319 ran 16 console suites of 287 and broke 6 it did not run. AGL-2346 added its
`after()` double to 8 webhook suites and missed 2 driving the same handler. AGL-2357
ran all of commerce and typecheck — but not `console:test`. None was a bad change.

## What a promotion will NOT ship — these deploy separately

- **Firestore rules** (AGL-2380) — includes the **`staffRole` fail-open → fail-closed
  fix**, committed and NOT live, plus order-field write denial (AGL-2237/2269).
  Until deployed, every order's `refundedCents` stays client-writable — and that is
  the cap the refund path reads.
- **Firestore indexes** — AGL-2367, AGL-2159.
- **Docker images** (AGL-2221), the **plugin-loader service** (AGL-2196), **edge
  middleware + CSP** (AGL-2217/2198).

## Decisions Zach delegated, and what was decided

- Bookings fee → **mirror the storefront ladder** (built via the existing `'service'`
  product type, no new rate constant).
- Subscription fee basis → **items-only** (built as an application-fee refund on
  `invoice.paid`; names no rate, so it structurally cannot become a pricing change).
- POS stock → **warn, never block**.
- Legal version → **already existed** as `LEGAL_DOCUMENT_VERSION` (`v6`); nothing invented.
- Marketing column width → **keep the product as-is**. `xl` renders 1392 at a 1440
  canvas and 1488 at 1920 — the design frames **to the pixel**. The "1280 content
  column" in `tools/marketing/*` was a **fiction**; corrected.

## Still owed by Zach

Rules + index deploys · `gh auth refresh -h github.com -s security_events` (the four
DOMPurify dismissals carry a **false** stated reason) · GA4 env vars
(`GA4_MEASUREMENT_ID` unset, four server events post into the void) · AGL-2333
(agency templates) · AGL-2373 (retro fee refund) · AGL-2331 (marketplace purchase
entitles a **person**, not the org — needs a §8.1 legal call).

## Money-path findings worth remembering

- **A partial refund reversed nothing** — a $50 concession on a $100 marketplace sale
  left Aglyn $30 down and the publisher untouched (AGL-2299).
- **Paid bookings never paid the merchant** — no Connect wiring at all (AGL-2315).
  Audited live: **$0 owed, zero rows** — but only because no booking has ever been
  taken. The pre-fix path is still what production serves.
- **Six of seven marketplace publish routes never asked for the publisher agreement.**
- **Screens cap:** the 8-of-5 alert Zach received is a **plan downgrade**, not a bug —
  and truthful. But two real laundering paths were found and fixed (AGL-2231, AGL-2369),
  and **both are unpromoted**, so production still has them open.
