# Releasing Aglyn

How a version number is decided, written, and attached to a deployed commit
(AGL-2089).

## What is versioned

**One version for the whole repo**, in the root `package.json`.

Not per-app and not per-lib:

- **Nothing here is published.** All 40+ `@aglyn/*` libs sit at the nx scaffold
  default `0.0.1`, and the `@aglyn` npm scope is unregistered — `npm view
@aglyn/aglyn` is a 404. Changesets and `nx release` both exist to coordinate
  the versions of packages that go to a registry. There is no registry here.
- **One SHA ships everything.** Only the `production` branch deploys
  ([docs/VERCEL_DEPLOYMENTS.md](VERCEL_DEPLOYMENTS.md), AGL-522), and console,
  tenant and docs all build from that one commit. Three app versions off one
  commit would be three names for one artifact.

So a version names **a deployed commit of this repo**. That is also exactly the
unit a self-host operator runs.

## The number

`MAJOR.MINOR.PATCH`, optionally `-<tag>.<n>` for a prerelease. Nothing else —
no build metadata, no bare prerelease tags — so that "is this ahead of that" is
never ambiguous.

### Bump policy

Derived from the conventional-commit subjects the repo already enforces
(`commitlint.config.js`), over the commits being promoted:

| In the batch                                                           | Bump      |
| ---------------------------------------------------------------------- | --------- |
| any `!` after the type/scope, or a `BREAKING CHANGE:` footer           | **major** |
| any `feat`                                                             | **minor** |
| any `fix`, `perf`, `revert`                                            | **patch** |
| only `docs` / `test` / `chore` / `ci` / `style` / `build` / `refactor` | **patch** |

The strongest signal in the batch wins — one `feat` among ninety-two `chore`s
is a minor.

That last row is deliberate: a promotion that reaches production **is** a
release whether or not its commits were user-facing, and two different deployed
artifacts must never carry the same number.

### While the version is a prerelease

During a prerelease series (`1.0.0-beta.3`), each release increments the series
number — `beta.3` → `beta.4` — and the base `1.0.0` does **not** move. The base
is a statement about what GA will be; a `feat` landing during beta does not
change that intent. The aggregate bump is still computed and printed so you can
see what the batch held, but it is reported, not applied.

Leaving a prerelease is a product decision, never an inference from commits:

```bash
npm run release:prepare -- --write --set 1.0.0
```

## Cutting a release

The bump is a **deliberate step in the promotion**, not a per-commit
automation. `main` moves constantly under many agents; a bump per commit would
collide on every push and would version things that never shipped.

Nothing below runs in CI — but not for the reason once recorded here. That
read "Nx CI is `disabled_manually` (AGL-1776) and no workflow builds PRs
(AGL-1777)", and both halves are false (AGL-2381): `nx-ci.yml` is **active**
and triggers on `pull_request`, so PRs are built. The release steps below
simply have no workflow that invokes them, and that is deliberate — the bump
is a step in the promotion, run by hand when Zach calls the batch.

### 1 — On `main`, when Zach calls the batch

```bash
npm run release:prepare                      # report only, changes nothing
npm run release:prepare -- --write           # writes package.json + CHANGELOG.md
```

Report-only is the default. Run it bare first to see what the batch contains
before committing to a number.

Then commit with explicit paths — never `git add -A`, which sweeps up other
agents' work:

```bash
git add CHANGELOG.md    # first release only; --only cannot stage a new file
git commit --only package.json CHANGELOG.md \
  -m 'chore(release): v1.0.0-beta.1 (AGL-2089)'
git push origin main
```

`chore(release): v<version>` is the one commit subject that carries no issue of
its own beyond AGL-2089.

### 2 — Promote, as usual

Gate the batch with [`tools/gate.sh`](#the-gate) (below), open the `main` →
`production` PR, real merge commit, never squash, no intermediate branches.
Then verify the deploy is live and serving that commit:

```bash
node tools/deploy/verify-production-aliases.mjs
```

### 3 — Tag the commit that is actually deployed

```bash
git fetch origin production
npm run release:tag                     # report only
npm run release:tag -- --write --push
```

The tag goes on the **merge commit on `production`**, not on the bump commit on
`main`. `main` is never deployed, and the merge SHA does not exist until the PR
is merged. Tagging after the fact means a tag asserts something stronger:

> this exact tree was built and served.

That is what makes "what shipped in v1.0.0-beta.3?" answerable a year later.

`release:tag` refuses unless the tag is new, the version at that commit is ahead
of the newest existing tag, and `CHANGELOG.md` there documents it. The second
guard catches the commonest real mistake — promoting a batch that did not
include the `chore(release)` commit.

## The gate

```bash
tools/gate.sh                      # gate origin/main, all phases
tools/gate.sh --ref <sha>          # gate a specific commit
tools/gate.sh --phases build       # one phase, same isolation
tools/gate.sh --keep               # keep the worktree for triage
tools/gate.sh --no-install         # refuse on lockfile drift, never install
```

It provisions a detached worktree at `/private/tmp/aglyn-gate/<stamp>/wt`, runs
**typecheck → lint → guards → test → production build**, and prints one exit
code per phase:

```
=== PHASE EXIT CODES ===
provision:root                     0
…
build:tenant                       0
=== 0 failing phase(s); gated <sha> ===
```

Four things about it are load-bearing, and each one is there because its
absence produced a gate result that read like a verdict and was not one.

**It isolates the nx cache.** A `git worktree` isolates the source tree and
`node_modules` and nothing else — nx keeps writing task results and terminal
outputs into the **original** checkout's `.nx/cache` (AGL-2090). When another
agent's process cleared that directory mid-run, nx died reaching for a file it
had just written, the test phase aborted after 18 of 40 projects, and
`console:test` never ran at all. `NX_CACHE_DIRECTORY` is the only thing that
moves it; the script sets it alongside `NX_DAEMON=false` and a private
`NPM_CONFIG_CACHE`, and compares the shared checkout's cache file count before
and after so a leak is reported rather than assumed away.

**It provisions all three module trees, by copy.** `apps/docs` and
`cloud/functions` are standalone npm packages on purpose — docs pins React 18
against the root's React 19, and `firebase deploy` packs `cloud/functions` as a
self-contained directory. A root-only worktree fails `docs:build` with
`docusaurus: command not found` and `cloud-functions:lint` with its own
not-installed guard. The two obvious shortcuts are both wrong: a **symlinked**
`node_modules` makes Turbopack refuse the tree outright (`Symlink
[project]/node_modules is invalid, it points out of the filesystem root`), so
the production build cannot run at all; and `cp -al` **hard links** both nest a
stray `node_modules/node_modules` when the destination already exists — two
Reacts, and 1000+ `Cannot read properties of null (reading 'useState')` — and
share inodes, so anything the gate writes goes straight back into the shared
checkout. The script uses `cp -Rc` (APFS copy-on-write): as fast as hard
linking, with none of that. `verify_modules` refuses each broken shape, and
`npm run test:gate-script` builds all of them on purpose to prove it still can.

**It never passes a passthrough flag to a shell-command target.** nx appends
unknown flags onto the command **string** of an `nx:run-commands` target, so
`nx run-many -t lint --maxWorkers=2` turns `cloud-functions:lint` into

```
/bin/sh: -c: line 0: syntax error near unexpected token `--maxWorkers=2'
```

`cloud-functions:lint`, `docs:build` and `docs:typecheck` are all run-commands
targets. `--maxWorkers` therefore goes **only** on the test phase, where every
target is `@nx/jest:jest`; lint and build get nx's own `--parallel`, which nx
consumes rather than forwards.

**It reads every exit code bare.** The command writes to a log file and its
status is read on the very next line — no trailing `| tee`, `| grep`, `| tail`.
A trailing filter returns _its own_ status, which is how a red production build
once got reported as green. For the same reason the build phase names
`console:build:production` and `tenant:build:production` explicitly: a bare
`nx run-many -t build` has gone green while both Next production builds errored.

**It installs when the lockfile moves.** The gate clones this checkout's
`node_modules`, which is honest only while the gated ref wants the same
packages. It does not, on every dependency bump — and a measured dependabot
branch would have been gated against cypress 15.20.1 while its lockfile said
15.21.0 (plus vitest, `@swc/core` and `eslint-plugin-storybook`). So
provisioning is decided per tree, per lockfile:

| gated ref's lockfile vs this checkout's | what happens |
|---|---|
| same | clone this checkout's tree (fast) |
| differs, tree cached under that hash | clone the cache (fast) |
| differs, no cache | **`npm ci`**, then cache it under the hash |
| differs, `--no-install` | **refuse, exit 1** |

Only the first gate of a dependency change pays for the install. It installs
rather than refusing because `.npmrc` sets `legacy-peer-deps=true`, so npm
accepts a broken peer graph **silently** — mobx 7 against a package peering
`mobx ^6.3.0` raised nothing at install time and failed at runtime inside
`makeObservable`. Only running the tests against the real tree catches that.
The summary always ends with a `provisioning:` line naming how each tree got
its packages.

**It snapshots itself.** `bash` reads a script lazily, by byte offset, so
editing `tools/gate.sh` while a run is in flight corrupts that run — the
symptom is a syntax error on a line number with nothing wrong with it. The gate
copies itself into its gate root and re-execs the copy, so a run is immune from
startup onward and callers do not have to know the hazard exists.

The guard phase is **derived from the CI workflows** (`nx-ci.yml` and
`tools-guards.yml`) rather than listed here, so a guard added to CI is gated
automatically and this file cannot quietly fall behind. If the derivation ever
yields zero, the phase fails rather than passing empty. The guards run
**concurrently** (`tools/scripts/run-guards.mjs`) — 55 of them in ~15s rather
than the 1m09s the old serial loop took.

The gate **reads the machine** rather than hardcoding its parallelism. A loaded
box gets `--parallel 2 --maxWorkers 2` — at or below the old pin, which existed
because six concurrent agents once drove this box to load 245 and the jest
SIGTERMs were misread as flaky tests for a day. An idle 10-core box gets 6/4.
`GATE_PARALLEL` / `GATE_MAX_WORKERS` still pin it explicitly.

## Getting a fix live in five minutes

On release day the question is not "is `main` perfect", it is "can this one fix
go out now". Three things answer it, in increasing cost.

**Before you commit — `npm run precheck`** (~16s). Type-checks the files you
changed against **every** tsconfig that could read them, spec configs included,
and runs the repo-wide guard sweeps. Those are the two classes that reach the
gate. The spec one is worth stating plainly, because the obvious command is the
wrong one:

```
tsc -p libs/<x>/tsconfig.lib.json --noEmit     # exits 0 with a broken spec
npm run precheck                               # exits 1, names the file
```

Every `tsconfig.lib.json` carries `"exclude": ["**/*.spec.ts", ...]`. Only the
sibling `tsconfig.spec.json` reads specs, and there are 40 of them. A
per-project check is real verification pointed at a config that excludes the
file being verified — that is how AGL-1725 shipped, and how it recurred on
2026-08-22. `precheck` prints what it did **not** run as its last line.

**For the fix itself — `tools/gate.sh --affected`.** Gates what the diff
touches, against `origin/production` by default (`--base <ref>` to override).

| | full | `--affected` |
|---|---|---|
| typecheck, `docs:typecheck` | whole workspace | **whole workspace** |
| all 55 guards | yes | **yes** |
| lint, test | every project | `nx affected` only |
| production builds | console, tenant, docs | **only affected apps** |

The two rows in bold are not narrowed, and that is deliberate. Three of
2026-08-22's four failures were repo-wide sweeps — a raw NUL byte, a banned
brand word, a stale generated table — and `nx affected` reasons over the
project graph, which those do not live in. Once the guard phase cost 15s there
was nothing left to win by narrowing it.

**What `--affected` stops proving:** lint and tests for every unaffected
project, and the production build of every app the diff does not reach. If no
app is affected at all, **zero** production builds run and the summary says so
in a phase row — an absent build line must never be read as a passing one. The
summary always names which path ran (`PATH: FAST` / `PATH: FULL`).

The fast path reuses a stable gate root, so a second run skips the ~1m35s
`cp -Rc` of the three module trees. Re-provisioning triggers on
`package-lock.json`'s blob hash.

**Promote a release with the full gate.** `--affected` proves a diff is sound
against a workspace it has not rebuilt; that is the right trade for a hot fix
and the wrong one for a release.

## `main` is gated continuously

`.github/workflows/main-gate.yml` gates `main` on a timer — typecheck plus every
guard every 15 minutes, and the full sweep including production builds hourly.

The verdict lands as a **commit status on the SHA that was gated**, so a red
belongs to the commit that caused it and shows beside that commit in the branch
and commit views. Two contexts, written independently:

| context | claims |
|---|---|
| `main-gate/fast` | typecheck, `docs:typecheck` and every guard are clean |
| `main-gate/full` | + the whole test sweep and all three production builds |

They are separate so a fast green cannot overwrite a full red — different
strengths of check must not share a slot. **A run that did not look writes
nothing at all**: the fast job skips its steps when `main` has not moved, and a
skipped GitHub Actions job reports `success`, so treating that as green would
clear a red on a `main` nobody happens to be pushing to. The decision lives in
`tools/scripts/gate-report.mjs` with a `--self-test`, because logic inline in a
workflow can only be tested by running the workflow, so nobody tests it.

It was written as a tracking issue first. That could not work — this repository
has issues **and** discussions disabled, so every red would have died at
`gh issue create`, and on the green path the step succeeded while doing nothing
at all, which is how a dead sink stays invisible until the moment you need it.

This exists because on 2026-08-22 a promotion gate came back red with four
unrelated failures that had all been sitting on `main` for hours, turning a
promotion into an unbounded repair session. Nothing was watching: `nx-ci.yml`
and `tools-guards.yml` moved their push trigger from `main` to `production` on
2026-08-20 because with many agents landing continuously they ran dozens of
times an hour and every red became noise.

A timer is the way out of that trade rather than around it — N commits collapse
into one run and one verdict, so the notification rate follows the cadence
instead of the commit rate. It does not replace this gate. It keeps `main` in a
state where running this gate is uneventful.

## The changelog range

`release:prepare` always diffs `origin/production..HEAD`.

Not "since the last tag": work flows `main` → `production` through a merge
commit, so a tag on that merge commit is **never** an ancestor of `main`, and a
tag-anchored range would fall through on every run after the first.
`origin/production` is by definition what is deployed, so the range is exactly
what is not yet released, and it self-corrects if a promotion is pulled.

If a release was prepared but never promoted, `release:prepare` refuses rather
than re-documenting the same commits under a second number.

## What the tags mean, and the two that do not

The series is `v<semver>` — `v1.0.0-beta.1`, `v1.0.0`, `v1.1.0`.

The repo also contains `sdk-framework-0.0.1` and `website-core-0.0.1`, both
`chore(release): 0.0.1` commits from 2021 and a dead per-library scheme
(`website-core-0.0.1` is not even an ancestor of `main`). The tooling ignores
any tag that is not `v<semver>`. **They are left alone** — history is not
rewritten here.

History before the first `v*` tag is **not** retroactively tagged. Roughly 2000
issues of work predate the scheme and the deployed SHA for each of them cannot
be established after the fact. The Linear project history is the record for that
period; `CHANGELOG.md` says so in its header.

## Where the version shows up

A bump feeds:

- `x-aglyn-package-version` on console and tenant responses
  (`with-aglyn.nextjs.config.js` — the single read of `package.json.version`).
  Note this header is gated under the white-label entitlement (AGL-2088).
- The `PACKAGE_VERSION` build-time env, re-exported as
  `PACKAGE_VERSION` from `@aglyn/shared-data-enums`.
- The console footer: `Version 1.0.0-beta.1 (<build-id>)`.
- Every `/api/health*` body on both apps, as `version` — nine routes, all
  through `platformVersion()` (AGL-2091). This is the surface a self-host
  operator reads, and it needs no configuration from them.

Those bodies also report `commit`, now resolved by `deploymentCommitRef()`
from `BUILD_ID`, then `COMMIT_REF`, then `VERCEL_GIT_COMMIT_SHA` — the same
precedence the footer's build id uses (AGL-2181), so the two surfaces cannot
disagree about the build that answered. Off Vercel it is `null` until an
operator stamps it; `docs/SELF_HOSTING.md` says how.

`libs/aglyn/src/lib/app-utils/health-version-coverage.spec.ts` fails the build
if a tenth health route forgets either field.

## Self-hosting

Operators run the whole repo as one unit and upgrade with `git pull && docker
compose up --build`, so the repo version is the right thing for them to report
and to compare across upgrades.

[docs/SELF_HOSTING.md](SELF_HOSTING.md) tells operators to watch the release
notes for Firestore rules changes. Those release notes are `CHANGELOG.md` — a
rules change appears there as a `fix(rules)` or `feat(rules)` entry with its
Linear id.
