# HANDOFF — 2026-08-18 late evening. **PROMOTED, DEPLOYED, TAGGED. CI GREEN.**

## State

- `production` = **`aed088401`**, tagged **`v1.0.0-beta.1`** (the repo's first release tag).
- 96 commits promoted, 67 Linear issues. All three Vercel projects **Ready**.
- Firestore rules **deployed from the promoted tree and verified** — `check:rules-drift` clean on
  all three surfaces, `check:index-drift` clean (44 composites, 23 field overrides).
- **CI green on `main`**: Tools guards ✅, Emulator guards ✅.
- Branches: only `main` and `production`. **All 12 `rescue/*` branches merged and deleted.**
- Worktrees: only the shared checkout and `/private/tmp/aglyn-gate/wt`. 27 stale ones removed.

## The lesson this promotion paid for — READ BEFORE THE NEXT GATE

**The nx gate is NOT the whole verification surface.** `nx run-many -t build/test/lint --all` was
green while CI was red, both honestly:

- `cloud/rules-tests/` has **no `project.json`**, so it is not an nx project and no jest `rootDir`
  covers it. Its only runner is `npm run test:rules` (emulators + JVM).
- `tools/` guard scripts run from `tools-guards.yml`, not from nx.

**Any future gate must also run `npm run test:rules` and the `tools-guards.yml` scripts, or state
plainly that it did not.** Two real defects reached production-adjacent `main` this way (AGL-2116,
AGL-2138).

Also: **a clean git merge is not a correct one.** AGL-2038's new test referenced a constant AGL-2002
had replaced. The two edits did not overlap, so git merged them silently and the file was broken.

## Merging the parked rescue branches — what it cost, and why it was right

Zach: *"why do we even have rescue branches with unmerged work, why is it not merged already."*
Correct. 16 commits were cherry-picked; 4 needed manual conflict resolution. It then broke **8
things** — 6 caught by the nx gate (AGL-2106), 2 only by CI (AGL-2116, AGL-2138).

Every one was the same shape: **a branch authored in an isolated worktree against a `main` that had
moved.** The sharpest was AGL-1993's `staff-claim-pool.spec.ts`, which **asserted the bug as a
passing test** — it deliberately pinned "project pool wins, so an emailless shadow takes the staff
grant" so a change in ordering would surface, and AGL-2005 then fixed that ordering. Both branches
were individually right and jointly contradictory.

⚠️ **Do not let work sit on a side branch again.** Two chains were reachable from **no ref at all**
and were one `/private/tmp` cleanup from being lost.

## Verification lore added today

- **A hung suite is worse than a red one.** AGL-2105: a spec looped through passive effects and
  microtasks, which **starves jest's real-timer `testTimeout`**, so it never failed — it produced no
  verdict, and "no result" read as "not red". `console:test` could not COMPLETE, so every console
  guard in the batch was unverified. Consider a jest-level guard that treats a missing summary as a
  failure.
- **A wholesale `jest.mock` is a CLOSED WORLD.** Any export the component/route tree reaches must be
  present. Four instances today: a `TypeError` (AGL-2103), a bogus 403 and a 500 (AGL-2106), and an
  infinite render loop (AGL-2105). A mock returning `() => ({})` — a NEW object per call — where the
  real hook returns a stable singleton manufactures a render loop the product cannot have.
- **Enumerate from `git ls-files`, never a filesystem walk.** AGL-2116: the colour ratchet swept
  untracked build output, so 21 files "gained" a colour for anyone who had built the docs and zero
  for anyone who had not, off the same commit. It measured machine state, not the repo.
- **`git branch --contains <sha>` answers "is this object reachable", NOT "did this work land".**
  After a cherry-pick those diverge. I wrongly declared AGL-1886 and AGL-2002 stranded on that basis;
  both were already on `main` under different SHAs. Check with `--grep` against
  `origin/production..origin/main`, and compare with `git patch-id --stable`.
- **Confirm every Linear id with `get_issue` BEFORE citing it.** Commit `3ff15f168` cites AGL-2109,
  which by then belonged to an unrelated marketplace-refund defect an agent had just filed. Correct
  record: AGL-2116. Ids move fast when agents run in parallel — predict nothing.

## Zach's standing directives added today

- **A PR body must enumerate the FULL contents of the batch** — generate the manifest from
  `git log`, group by conventional-commit type, keep every `(AGL-xxxx)`, state commit AND issue
  counts. Highlights never replace the full list. (Memory: `feedback_pr_body_must_list_full_contents`.)
- **Keep the pipeline fed** — spawn agents continuously as others finish; file AND fix together.

## Blocked on Zach

- **GA4 reports.** The Claude-in-Chrome bridge will not connect: `list_connected_browsers` returns
  `[]` across 7 attempts and two relinks, which means **no extension instance is signed into the same
  Anthropic account as the Claude Code session** — an account mismatch, not an install problem.
  The full click-level build spec is on **AGL-1637** and is ready to execute in one pass.
  ⚠️ Do NOT set the internal-traffic filter Active until both directions are verified via
  `Test data filter name` — an Active filter permanently discards matching data.
  ⚠️ Do NOT pick a Reports-snapshot template; a snapshot already exists behind that chooser.
- **4 open DOMPurify Dependabot alerts.** Deliberately unpatched — no released `monaco-editor`
  vendors a newer DOMPurify, and the vendored copy is never imported (call-site evidence on
  AGL-2051). Decision owed: leave open as a standing prompt, or dismiss as `not_used`.

## Open agent branches — merge after re-gating

`agl/dependabot` (AGL-2107 brace-expansion, AGL-2108 lockfile drift), `agl/capability-surface`
(AGL-2113/2115/2119), plus money-path, retention, parity, docs-api, selfhost and stripe-staff
branches as they land. **All were branched off an older `main` — re-gate before promoting**, and
expect the same authored-against-a-moved-main breakages.

## Still open

- **AGL-2085** — capability sweep recorded 123 routes; a re-derivation counted **130** and could not
  account for 7. A count that does not reconcile means the next sweep re-derives rather than trusts.
- **AGL-2131** — `staffRole` **fails open to `super`** in two places while failing closed everywhere
  else. Decide what `support` means before building the UI.
- AGL-2013, AGL-2033 bookkeeping; `awaiting-decision` queue is Zach's.
