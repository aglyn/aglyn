# Working in this repository

## Verify in the cheapest tier that can see the mistake

Three tiers exist. They are not interchangeable, and collapsing them is the
single largest source of first-run CI reds (AGL-2752).

| tier | command | measured | when |
| -- | -- | -- | -- |
| targeted | `npx eslint <staged tools files>`, `npm run typecheck:changed` | seconds | before every push |
| guards | `node tools/scripts/run-guards.mjs --concurrency 8` | 102 guards, 146s | once, before opening a promotion PR |
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
