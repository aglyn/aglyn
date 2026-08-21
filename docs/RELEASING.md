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

The guard phase is **derived from the CI workflows** (`nx-ci.yml` and
`tools-guards.yml`) rather than listed here, so a guard added to CI is gated
automatically and this file cannot quietly fall behind. If the derivation ever
yields zero, the phase fails rather than passing empty.

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
