# Working in this repository

## A fix for a sign-up or access blocker ships to production the same hour

If a bug stops anyone from signing up, signing in, verifying, getting a
workspace, loading the console or a site, publishing, or paying, its fix goes
to production IMMEDIATELY. Getting it there is part of the fix (AGL-3690: the
fix for a phone sign-up loop merged to main and then sat there unpromoted).
The session that fixes it owns the whole path, in the same turn:

1. Merge the fix to main as soon as it is green. Never leave it as a draft.
2. If a promotion PR is open, `git merge origin/main` into it. If none is,
   cut `release/v…` with `npm run release:prepare -- --write`, adding
   `--hotfix` and the `hotfix` label when the day's cap is reached, and push
   the same head to `main`.
3. Label the promotion `hotfix`. `auto-merge-green.yml` merges a `hotfix`
   promotion the moment every check is green, which is the one exception to
   "a promotion is merged by a person". If you are still there when it turns
   green, `gh pr merge <n> --merge` is equally fine. GitHub's own auto-merge
   button is turned off on PRs into `production`, so don't use it. A red check
   gets fixed, never overridden.
4. Do the tail in the same hour: aliases serve the merge, the owed rules and
   indexes are deployed (`check-promotion-deploys --list`), `release:tag`,
   then reproduce the broken flow in production and confirm it works.

⛔ "It rides the next promotion" is not an acceptable state for this class.
A fix that is on main and missing from production counts as the bug still
being live.

## Every PR body details every change and every commit in it

Zach, 2026-10-09, standing: a PR description lists every change it carries and
every commit in it, especially a promotion PR. For a promotion, that is each
merged PR (number, title, one line on what it does) and each direct commit
(short sha, subject) in `origin/production..HEAD`, grouped by area.

⛔ The body is ALWAYS kept current. EVERY time anything new lands on an open
PR (a CI fix, a `git merge origin/main`, another PR riding the promotion, a
single commit), `gh pr edit <n> --body-file …` goes out in the same step as the
push, before you do anything else — and the TITLE is updated too, so it
names what the PR now carries. A body that lags the branch by even one commit,
says "plus a few fixes", or lists only the headline PRs, is incomplete.

⛔ A promotion PR's title is exactly `Release v1.0.0-beta.N` and never
changes; its themes go in the body, not the title (Zach, 2026-10-09).

## Verify in the cheapest tier that can see the mistake

Four tiers exist. They are not interchangeable, and collapsing them is the
single largest source of first-run CI reds (AGL-2752).

| tier | command | measured | when |
| -- | -- | -- | -- |
| targeted | `npx eslint <staged tools files>`, `npm run typecheck:changed` | seconds | before every push |
| pre-push | `.husky/pre-push` runs `tools/scripts/prepush.mjs` by itself (AGL-2837) | 2.3s for 8 files, 2.6s for 217 | every `git push` |
| guards | `node tools/scripts/run-guards.mjs --concurrency 8` | 125 guards, 88s | before a promotion PR — and it is the same sweep Main Gate's `fast` job runs, at `--concurrency 4` |
| gate | `bash tools/gate.sh` | 25-90 min | never locally — the PR runs it |

⛔ Do not run `tools/gate.sh` locally. The `main`→`production` PR runs the same
work, and running it twice delays the promotion it was meant to protect.

⚑ "Do not run the gate" is not "do not check anything." The targeted tier costs
seconds and catches the majority of what CI actually rejects. Skipping it does
not save time; it moves the same failure to a place where it costs a CI cycle
and blocks every commit stacked behind it.

## `tools/` has no type coverage

`npm run typecheck` walks the Nx project tsconfigs. Nothing under `tools/` is
in one, so a newly written `tools/scripts/*.mjs` has no local signal until
`check:lint-tools` — plain `eslint tools` — rejects it in CI. That guard is the
most frequent red in the workflow's history, and the errors it catches are
shallow: dead assignments, unused bindings.

Touching anything under `tools/` means linting it. The pre-commit hook does
this for staged files; run `npx eslint tools` directly when committing is not
the next step.

## An `AGL-nnnn` above the ceiling fails the build

`check:linear-ids` sweeps tracked source *and* commit messages for issue
citations and refuses any number Linear has not assigned. Cite only ids that
exist — create the issue first and use what the workspace returns. Issue
numbers are not sequential from the last one you saw, because peer sessions
take ids in between.

History is never rewritten here, so a fabricated id in a commit message can
only be resolved by adding the sha to the forgiven list in
`tools/scripts/linear-issue-ceiling.json` — a list that is allowed to shrink
and never to grow.

## One break reds every commit behind it

`main-gate.yml` runs on every push to `main`. A single break is therefore
re-reported against each subsequent commit until it is fixed, which makes a run
of reds look like a run of separate mistakes. Read the failing step before
concluding anything about how many breaks there are.

## The checkout is shared

Several sessions work in this checkout at once. Scope every check to what you
staged rather than to the whole tree, or a peer's in-flight edit reads as your
failure. The same applies to git: never `commit -a`, `amend`, `reset --soft`,
or rebase a branch someone else may be standing on.

### Realigning local `main` is the LAST STEP of a worktree push, not a later chore

Local `main` drifts by a ratchet, one notch per session, and it never heals on
its own. The loop: you commit on `main` here, `origin` has moved by then so the
push is rejected, you push from a throwaway worktree instead — which puts your
work upstream under a DIFFERENT sha — and the original is left on local `main`
forever. Six sessions did exactly that on 2026-09-21 and left it `ahead 6,
behind 175`, every one of the six already upstream (AGL-3213 session).

So whenever you push from a worktree, finish the job here:

```bash
git fetch origin
git cherry -v origin/main main   # every line must start with '-' (already upstream)
git status --porcelain           # must be empty — a peer's edit is not yours to move
git branch main-stale-$(date +%F)-$(git rev-parse --short main) main
git reset --keep origin/main
```

Then retire the backup, in the same breath (AGL-3221):

```bash
git cherry -v origin/main main-stale-<name>   # every line '-', as before the reset
git branch -D main-stale-<name>
```

⛔ `git log origin/main..main-stale-<name>` is NOT the test, though it reads
like it. It asks what is REACHABLE, and the whole reason you are here is that
the worktree push put your commit upstream under a different sha — so the
backup lists it as unique forever and the branch never looks retirable. The
patch-id check is the one that answers it, which is why the recipe opens with
the same line.

It is a backup for the seconds the reset takes, not a record. All `-` means
every commit it was holding is upstream, which is the only thing it was
protecting against; after that it is clutter, and it accumulates fast — four of them were
minted on 2026-09-21 alone, one within half an hour of the last sweep. The sha
suffix is what lets two sessions realign on the same day: `$(date +%F)` on its
own collides, `git branch` refuses the second, and you get `-b` and `-agl3216`
names nobody can later tell apart.

⚑ `--keep`, never `--hard`. It ABORTS when a file it would overwrite has local
changes, instead of destroying a peer's uncommitted work — which is the half of
`reset` that cost two sessions their edits (2026-08-24), and the backup branch
is the other half: a commit that is on a named branch cannot be orphaned, which
is what cost two peers six commits (2026-09-03). With both, the standing "never
`reset` on the shared checkout" has a safe exception, and this is it.

⛔ If `git cherry` prints a `+`, STOP — that commit is not upstream and a reset
would strand it. Find out whose it is first.

### Do not leave a long edit uncommitted here

The tree is public property: a peer's broad `git add` will sweep your
half-finished change into their commit, under their issue. Anything that takes
more than a few minutes belongs in a worktree cut from `origin/main` — which is
also the only way to test against what actually ships, since this tree can be
hundreds of commits stale.

Clean your worktree up when it merges. `git worktree remove` without `--force`
refuses a dirty one, so it can never take a live session's work.

## Package boundaries

Every `libs/**` project is a future npm package; `docs/PACKAGES.md` is the map
(npm name, entry points, what it may import) and `check:lib-boundaries` holds
it. An app never holds logic a consumer would need — it goes in a lib. A plugin
never imports another plugin or core's UI; core never imports a plugin; `shared`
imports only `shared`. A new lib gets its `scope:`/`type:` tags and its map row
in the same commit. The allowlist of today's cross-package edges only shrinks.

A lib's `package.json` declares every package its shipped source imports
(AGL-3201), because inside this repo an undeclared import still resolves and
the published package would not install. Adding an import of a package the lib
does not yet name reds `check:lib-boundaries`, which the pre-push hook runs:
`npm run sync:lib-dependencies` writes the declaration. Never import a
transitive dependency of something else (`@popperjs/core` through MUI,
`@firebase/firestore` through `firebase`) — it cannot be declared honestly.

A spec that needs two plugins at once lives in `apps/console/specs` or
`apps/tenant/specs` and reaches each through the generated manifest's
`load()`; one plugin's spec never imports another plugin. Moving or renaming a
file means grepping its old path across specs, `tools/` and `docs/` first:
path-keyed sweep specs import nothing, so only the whole console suite sees
them.
