#!/usr/bin/env bash
#
# tools/gate.sh — the promotion gate (AGL-2090)
#
# Runs typecheck, lint, the out-of-nx guards, the full test sweep and the
# PRODUCTION builds against a pinned, isolated copy of a git ref, then prints
# one exit code per phase.
#
#   tools/gate.sh                          # gate origin/main
#   tools/gate.sh --ref <sha|branch>       # gate something else
#   tools/gate.sh --phases typecheck,build # a subset, same isolation
#   tools/gate.sh --root /private/tmp/g7   # a specific gate root
#   tools/gate.sh --keep                   # leave the worktree for triage
#   tools/gate.sh --affected               # THE FAST PATH — see below
#   tools/gate.sh --no-install             # refuse on lockfile drift, never install
#   tools/gate.sh --lock-wait 300          # queue behind a run holding the root
#
# ---------------------------------------------------------------------------
# TWO PATHS, AND THE ONE THAT RAN IS ALWAYS NAMED (AGL-2486)
# ---------------------------------------------------------------------------
# FULL (the default). Everything, workspace-wide. This is the promotion gate.
#
# AFFECTED (`--affected`). For a hot fix on release day: gate what the diff
# touches. It is a DIFFERENT, WEAKER claim, and the summary says so in words
# rather than leaving the reader to infer it from a flag.
#
#   still whole-workspace, never narrowed:
#     - typecheck        the workspace's only type gate, and the 2026-08-22
#                        spec-tsconfig failure is exactly what a narrowed one
#                        would have missed
#     - docs:typecheck   a standalone package, excluded from the sweep by name
#     - EVERY GUARD, including the repo-wide sweeps (run-guards.mjs) — the
#                        NUL-byte, brand-literal, tax-identifier and generated-
#                        artifact checks. `nx affected` reasons over the
#                        project graph and these do not live in it. Three of
#                        2026-08-22's four failures were from this class, so
#                        this is the one narrowing that has actually cost a
#                        promotion. `--only` cannot switch them off.
#
#   narrowed to `nx affected`:
#     - lint, test       the project graph is exactly the right scope for these
#
#   NOT narrowed, though the first design said it would be: the ~34
#   project-shaped guards. Narrowing them was the plan until the guards phase
#   went from 1m09s to ~15s by running concurrently. That left a few seconds
#   on the table against the cost of getting a guard-to-project mapping wrong,
#   which is a guard silently sitting out the one commit it exists to catch.
#   All of them run on both paths.
#
#   narrowed, and this is the one to read twice:
#     - PRODUCTION BUILDS run only for the apps `nx affected` marks. A change
#       under apps/tenant does not build console. If NO app is affected — a
#       tools/-only or docs-only diff — then ZERO production builds run, and
#       the summary says `build: NO app affected — 0 production builds` rather
#       than printing a green build line. A gate that reports a build it never
#       ran is the failure mode this whole script exists to prevent.
#
# So: `--affected` proves the diff is sound against a workspace it has not
# rebuilt. Use it for a hot fix. Promote a release with the full path.
#
# ---------------------------------------------------------------------------
# WHY THIS SCRIPT EXISTS, AND THE FIVE TRAPS IT ENCODES
# ---------------------------------------------------------------------------
# The gate used to be a hand-typed recipe. Every one of these cost a real gate
# run, and every one of them LOOKED like a flaky test or a red build.
#
# TRAP 1 — a pinned worktree does NOT isolate the nx cache (AGL-2090).
#   A `git worktree` isolates the source tree and node_modules and nothing
#   else: nx still writes task results and terminal outputs into the ORIGINAL
#   checkout's `.nx/cache`. Two agents in "separate" checkouts share one cache.
#   When another process cleared it mid-run, nx died reaching for a file it had
#   just written:
#       ENOENT: no such file or directory, open
#       '<checkout>/.nx/cache/terminalOutputs/5760910…'
#   The test phase aborted after 18 of 40 projects and `console:test` never ran
#   at all — while the run still reported an exit code that read like a verdict.
#   NX_CACHE_DIRECTORY (set below) is the only thing that actually moves it.
#
# TRAP 2 — a SYMLINKED node_modules breaks Turbopack outright.
#   `ln -s ../aglyn/node_modules wt/node_modules` is the obvious shortcut and it
#   makes the production build impossible to run:
#       Symlink [project]/node_modules is invalid, it points out of the
#       filesystem root
#   So `build --configuration=production` — the phase this gate exists for —
#   cannot execute at all. Never symlink. `verify_modules` below refuses one.
#
# TRAP 3 — `cp -al` hard links are wrong TWICE.
#   (a) `cp -al src dest` where `dest` already exists copies INTO it, leaving a
#       stray `node_modules/node_modules`. That second tree is a second copy of
#       React, and every renderer test then fails with
#       `Cannot read properties of null (reading 'useState')` — 1000+ of them.
#   (b) Worse and quieter: hard links SHARE INODES, so anything the gate writes
#       into its node_modules writes straight back into the shared checkout.
#       Measured: writing to the hard-linked copy changed the source file.
#   This script uses `cp -Rc` (APFS clonefile) instead: copy-on-write, so it is
#   as fast as hard-linking (195M in ~3s) but a write to the clone leaves the
#   source untouched — measured, both ways. `cp -R` is the non-APFS fallback.
#
# TRAP 4 — apps/docs and cloud/functions have their OWN node_modules.
#   Neither is an npm workspace, deliberately (apps/docs pins React 18 against
#   the root's React 19; cloud/functions is packed and uploaded standalone by
#   `firebase deploy`). A root-only install fails `docs:build` with
#   `docusaurus: command not found` and `cloud-functions:lint` with its own
#   "dependencies are not installed" guard. Three trees, always.
#
# TRAP 5 — nx APPENDS passthrough flags onto shell-command targets.
#   `nx run-many -t lint --maxWorkers=2` does not just configure jest; for any
#   `nx:run-commands` target it appends the flag to the command STRING:
#       /bin/sh: -c: line 0: syntax error near unexpected token `--maxWorkers=2'
#   `cloud-functions:lint`, `docs:build` and `docs:typecheck` are all
#   run-commands targets. So `--maxWorkers` goes ONLY on the test phase (where
#   every target is @nx/jest:jest); the lint and build phases get nx's own
#   `--parallel`, which nx consumes rather than forwards.
#
# ---------------------------------------------------------------------------
# READING EXIT CODES
# ---------------------------------------------------------------------------
# Every measured command writes to a log file and its status is read BARE on
# the very next line. No trailing `| tee`, `| grep`, `| tail`, `| head`. A
# trailing filter returns ITS OWN status, which is almost always 0 — that is
# how a red production build was once reported as green. If you edit `run()`,
# keep the command and the `code=$?` adjacent.
#
set -uo pipefail

# --- arguments -------------------------------------------------------------
REF="origin/main"
GATE_ROOT=""
KEEP=0
FRESH_CACHE=0
SELF_TEST=0
# `auto` means "read the machine". See choose_parallelism below. GATE_PARALLEL
# / GATE_MAX_WORKERS still pin it, and so do --parallel / --max-workers.
PARALLEL="${GATE_PARALLEL:-auto}"
MAX_WORKERS="${GATE_MAX_WORKERS:-auto}"
PHASES="typecheck,lint,guards,test,build"
AFFECTED=0
AFFECTED_BASE=""
# Installing is the default. --no-install turns the "lockfile moved" case from
# an install into a REFUSAL, for an offline box — never into a silent clone.
ALLOW_INSTALL=1
PROVISION_NOTE=""
# Seconds to queue behind a run already holding the gate root before refusing.
# Zero — refuse immediately — is the default because the caller is usually a
# human at a terminal who would rather be told than blocked.
GATE_LOCK_WAIT="${GATE_LOCK_WAIT:-0}"

# The parse loop consumes "$@", and the self-snapshot below has to re-exec with
# exactly what the caller passed. Saved before anything eats it.
GATE_ORIG_ARGS=("$@")
# Absolute, and resolved now: the snapshot copies this file, and by the time it
# runs the script may have chdir'd into the worktree.
SELF_PATH=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")

while [ $# -gt 0 ]; do
  case "$1" in
    # Accept `--flag=value` as well as `--flag value`. Without this the equals
    # form hit the unknown-argument branch below and the gate exited 64 having
    # measured nothing — which, launched under `nohup … &`, looked like a
    # successful background start. Normalise, do not reject.
    --*=*) set -- "${1%%=*}" "${1#*=}" "${@:2}"; continue ;;
    --ref)          REF="$2"; shift 2 ;;
    --root)         GATE_ROOT="$2"; shift 2 ;;
    --phases)       PHASES="$2"; shift 2 ;;
    --parallel)     PARALLEL="$2"; shift 2 ;;
    --max-workers)  MAX_WORKERS="$2"; shift 2 ;;
    --keep)         KEEP=1; shift ;;
    --fresh-cache)  FRESH_CACHE=1; shift ;;
    --self-test)    SELF_TEST=1; shift ;;
    --affected)     AFFECTED=1; shift ;;
    --no-install)   ALLOW_INSTALL=0; shift ;;
    --lock-wait)    GATE_LOCK_WAIT="$2"; shift 2 ;;
    --base)         AFFECTED_BASE="$2"; shift 2 ;;
    -h|--help)      sed -n '2,80p' "$0"; exit 0 ;;
    *) echo "gate: unknown argument '$1'" >&2; exit 64 ;;
  esac
done

# Normally derived from this file's location. After the self-snapshot below the
# script runs from inside the gate root, where that derivation would resolve to
# the wrong tree entirely — so the real value is handed down through the
# environment and this line is only ever used by the FIRST invocation.
SOURCE_REPO="${GATE_SOURCE_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

# --- adaptive parallelism --------------------------------------------------
# The gate was pinned at `--parallel 3 --maxWorkers 2`. That pin is CORRECT and
# it is why it existed: six concurrent agents once drove this box to load 245,
# jest workers were SIGTERMed for memory, and the kills were read as flaky
# tests for most of a day. Anything that raises the numbers unconditionally
# re-buys that incident.
#
# But the pin is also wrong most of the time. On an idle 10-core box it leaves
# the machine two-thirds empty across a 15-minute run, and the test phase — 6m31s
# of it, `console:test` alone 6m30s — is precisely where the unused cores are.
#
# So: read the load and choose. `uptime`'s 1-minute average against the core
# count, which is the same reading a human is told to take before calling
# anything a flake. The bands are deliberately coarse, because the input is
# noisy and a precise formula over a noisy input is false precision.
#
# The floor is the old pin. Under load this returns 2/2 — at or below what was
# hardcoded — so adapting can only ever make a loaded box calmer, never busier.
# The ceiling is bounded by cores, not by ambition.
cpu_count() {
  sysctl -n hw.logicalcpu 2>/dev/null || nproc 2>/dev/null || echo 4
}

load_1m() {
  # Two formats, and getting this wrong is silent — a mis-parsed load reads as
  # 0, which puts a box at load 245 in the `idle` band and re-buys the exact
  # incident the pin exists for. Measured on this machine:
  #   macOS : "load averages: 23.46 27.49 24.56"   (spaces, plural label)
  #   Linux : "load average: 0.52, 0.58, 0.59"     (commas, singular label)
  # Split off the label, then take the first whitespace-or-comma field.
  # `--self-test` asserts both formats parse, because a wrong answer here
  # cannot be noticed by reading the summary. The parse is split out so the
  # self-test exercises THIS code rather than a copy of it — an assertion
  # against a reimplementation passes happily while the real one is broken.
  parse_load "$(uptime)"
}

parse_load() { # parse_load <uptime output>
  printf '%s\n' "$1" | sed -e 's/.*load average[s]*: *//' -e 's/[, ].*//' | tr -d ' '
}

# normalize_projects <nx output> -> a space-separated project list.
#
# `nx show projects` prints ONE NAME PER LINE on a TTY and a JSON ARRAY when
# stdout is a pipe — which, inside this script, is always. Measured:
#
#   $ nx show projects --affected ... | od -c
#   [   "   t   e   n   a   n   t   "   ,   "   t   e   n   a   n   t   -   e   2   e   "   ]  \n
#
# The first version of this matched `*" tenant "*` against that string, which
# cannot match, so a one-file change under apps/tenant reported "NO app
# affected" and ran ZERO production builds. The gate said so out loud rather
# than printing a green build row — that line is why this was caught on the
# first measured run instead of on release day — but it was still the wrong
# answer, and the wrong answer in the direction of proving less.
#
# Handles both shapes: strip JSON punctuation, then collapse whitespace. A
# plain newline-separated list passes through unharmed, so this stays correct
# whichever way a future nx decides to print.
normalize_projects() {
  printf '%s' "$1" | tr -d '[]"' | tr ',\n' '  ' | tr -s ' ' | sed 's/^ //;s/ $//'
}

# choose_parallelism -> sets PARALLEL and MAX_WORKERS when either is `auto`.
choose_parallelism() {
  local cores load band p w
  cores=$(cpu_count)
  load=$(load_1m)
  [ -n "$load" ] || load=0

  # Integer arithmetic only (bash has no floats): compare load*10 to cores*10.
  local load10 cores10
  load10=$(printf '%.0f' "$(echo "$load * 10" | bc -l 2>/dev/null || echo "${load%.*}0")")
  cores10=$((cores * 10))

  # p = nx tasks in flight, w = jest workers per task, g = concurrent guard
  # processes, t = concurrent `tsc` processes. The last two are separate
  # numbers rather than a multiple of `p` — a guard and a tsc are much lighter
  # than a jest worker, but deriving them as `p * 2` made the LOADED band pick
  # 4, which is more than the guard runner would have chosen for itself (2) and
  # more than the old hardcoded typecheck pool. A budget that gets less
  # conservative under load than the thing it overrides is not a budget.
  if [ "$load10" -le $((cores10 * 3 / 10)) ]; then
    band="idle"; p=6; w=4; g=8; t=8
  elif [ "$load10" -le $((cores10 * 7 / 10)) ]; then
    band="light"; p=4; w=3; g=6; t=6
  elif [ "$load10" -le "$cores10" ]; then
    band="busy"; p=3; w=2; g=4; t=4
  else
    band="loaded"; p=2; w=2; g=2; t=2
  fi
  GUARD_CONCURRENCY="$g"
  export TYPECHECK_CONCURRENCY="$t"

  # Never more nx tasks than cores, whatever the band says.
  [ "$p" -gt "$cores" ] && p=$cores

  local from_p="$PARALLEL" from_w="$MAX_WORKERS"
  [ "$PARALLEL" = "auto" ] && PARALLEL="$p"
  [ "$MAX_WORKERS" = "auto" ] && MAX_WORKERS="$w"
  PARALLELISM_NOTE="cores=$cores load1m=$load band=$band -> --parallel=$PARALLEL --maxWorkers=$MAX_WORKERS"
  [ "$from_p" = "auto" ] || PARALLELISM_NOTE="$PARALLELISM_NOTE (parallel PINNED to $from_p)"
  [ "$from_w" = "auto" ] || PARALLELISM_NOTE="$PARALLELISM_NOTE (maxWorkers PINNED to $from_w)"
}

# ---------------------------------------------------------------------------
# TRAP 6 — CLONING node_modules DOES NOT INSTALL THEM (AGL-2486)
# ---------------------------------------------------------------------------
# This script clones the SOURCE CHECKOUT's node_modules. That is correct only
# while the gated ref wants the same packages the source checkout has. Gate a
# ref whose package-lock.json differs — every dependency bump, every dependabot
# batch — and the whole run compiles, lints, tests and BUILDS against the old
# packages, then prints exit 0. Measured on a merged dependabot branch:
#
#     cypress                  cloned 15.20.1   branch lockfile 15.21.0
#     vitest                          4.1.10                    4.1.11
#     @swc/core                       1.16.0                    1.16.1
#     eslint-plugin-storybook         10.5.8                    10.5.9
#
# That is a green that means nothing, on the one class of change where the
# packages ARE the change.
#
# It got worse with the reuse stamp: the stamp recorded the GATED REF's lock
# hash while the modules had come from the source checkout, so a second run at
# the same ref reported `provision: REUSED` for a tree that had never matched
# it. The stamp was recording provenance it did not have.
#
# So provisioning is now decided per tree, by comparing what the gated ref
# WANTS against what the candidate source HAS:
#
#   want == source checkout's lock  ->  clone from the source checkout (fast)
#   a cached tree exists for want   ->  clone from that cache (fast)
#   otherwise                       ->  npm ci, then cache it under want
#   install refused/failed          ->  FAIL LOUDLY. Never exit 0.
#
# The cache is keyed by the lockfile blob hash, so the second gate of a
# dependency change is as fast as any other gate and only the first pays.
#
# Why INSTALL rather than simply refuse: .npmrc sets `legacy-peer-deps=true`,
# so npm installs a broken peer graph SILENTLY. A real case — mobx 7 against
# mobx-state-tree@7.3.2, which peers mobx ^6.3.0 — produced no install error at
# all and failed only at runtime inside makeObservable (`Cannot read properties
# of undefined (reading 'make_')`). Nothing but running the tests against the
# real tree catches that, which is precisely what a gate is for. Refusing would
# be honest; installing is honest AND useful.

# The npm cache is STABLE and gate-owned, for two reasons. Speed across runs is
# the small one. The real one: `npm ci` against the user's ~/.npm/_cacache
# fails with EACCES on root-owned entries left by some past sudo install, and
# the fix for that must never be `sudo chown` on somebody's home directory.
NPM_CACHE_HOME="${GATE_NPM_CACHE:-/private/tmp/aglyn-gate/npm-cache}"
MODULES_CACHE="${GATE_MODULES_CACHE:-/private/tmp/aglyn-gate/modules}"

clone_tree() { # clone_tree <src dir> <dest dir>
  local src="$1" dest="$2"
  [ -d "$src" ] || { echo "gate: $src missing" >&2; return 1; }
  # TRAP 3(a): the destination MUST NOT exist, or the copy nests inside it.
  rm -rf "$dest"
  mkdir -p "$(dirname "$dest")"
  # TRAP 2 / 3(b): a real directory (never a symlink), copy-on-write (never
  # hard links, which would let the gate write back into the shared checkout).
  cp -Rc "$src" "$dest" 2>/dev/null || cp -R "$src" "$dest"
}

# provision_plan <want> <have_src> <cache_hit 0|1> <install_allowed 0|1>
#   -> one of: source | cache | install | refuse
#
# Pure, so --self-test can exercise every branch including the ones that need
# a network and ten minutes to reach for real. `refuse` is a verdict, not an
# error path: a gate that cannot honestly verify a dependency change has to say
# so instead of printing a green, the same rule as `build: NO app affected`.
provision_plan() {
  local want="$1" have="$2" cache_hit="$3" install_ok="$4"
  # An unresolvable lockfile means we cannot reason about the tree at all.
  # That is a refusal, never a shrug that falls through to cloning.
  case "$want" in ''|unknown) echo refuse; return ;; esac
  if [ "$want" = "$have" ]; then echo source
  elif [ "$cache_hit" = 1 ]; then echo cache
  elif [ "$install_ok" = 1 ]; then echo install
  else echo refuse
  fi
}

# provision_tree <slug> <lock rel path> <node_modules rel path>
provision_tree() {
  local slug="$1" lockrel="$2" modrel="$3"
  local want have plan cache_dir hit=0
  want=$(git -C "$WT" rev-parse "HEAD:$lockrel" 2>/dev/null || echo unknown)
  have=$(git hash-object "$SOURCE_REPO/$lockrel" 2>/dev/null || echo none)
  cache_dir="$MODULES_CACHE/$slug/$want"
  [ -d "$cache_dir/node_modules" ] && hit=1
  plan=$(provision_plan "$want" "$have" "$hit" "$ALLOW_INSTALL")

  echo "tree=$slug want=$want source=$have plan=$plan"
  PROVISION_NOTE="$PROVISION_NOTE $slug=$plan"

  case "$plan" in
    source)
      clone_tree "$SOURCE_REPO/$modrel" "$WT/$modrel" || return 1
      ;;
    cache)
      clone_tree "$cache_dir/node_modules" "$WT/$modrel" || return 1
      ;;
    install)
      echo "gate: $lockrel differs from the source checkout — INSTALLING $slug."
      echo "      cloning would compile against the wrong packages (trap 6)."
      # A stale tree must not survive the install: npm ci removes node_modules
      # itself, but only the one it is pointed at.
      rm -rf "$WT/$modrel"
      local prefix_args=""
      [ "$modrel" = "node_modules" ] || prefix_args="--prefix ${modrel%/node_modules}"
      # shellcheck disable=SC2086
      ( cd "$WT" && npm ci $prefix_args ) || {
        echo "gate: npm ci FAILED for $slug. This gate cannot verify $lockrel."
        return 1
      }
      [ -d "$WT/$modrel" ] || { echo "gate: npm ci left no $modrel"; return 1; }
      mkdir -p "$cache_dir"
      clone_tree "$WT/$modrel" "$cache_dir/node_modules" || return 1
      echo "gate: cached $slug under $want"
      ;;
    refuse)
      echo "gate: REFUSING to provision $slug."
      echo "      $lockrel at the gated ref ($want) differs from this checkout"
      echo "      ($have), no cached tree exists for it, and installing is off."
      echo "      Cloning would gate the WRONG PACKAGES and report success."
      echo "      Re-run without --no-install, or install that lockfile by hand."
      return 1
      ;;
  esac
  printf '%s\n' "$want" > "$GATE_ROOT/.provisioned-$slug"
  return 0
}

# provision_reusable <slug> <lock rel path> <node_modules rel path>
# True only when the tree already in the worktree was provisioned FOR THIS
# lockfile. The old stamp compared against the gated ref while the modules came
# from somewhere else entirely, which is how a mismatched tree reported REUSED.
provision_reusable() {
  local slug="$1" lockrel="$2" modrel="$3" want stamp
  want=$(git -C "$WT" rev-parse "HEAD:$lockrel" 2>/dev/null || echo unknown)
  case "$want" in ''|unknown) return 1 ;; esac
  stamp=$(cat "$GATE_ROOT/.provisioned-$slug" 2>/dev/null || echo none)
  [ "$stamp" = "$want" ] || return 1
  [ -d "$WT/$modrel" ] || return 1
  return 0
}

verify_modules() {
  local bad=0
  for rel in node_modules apps/docs/node_modules cloud/functions/node_modules; do
    if [ -L "$WT/$rel" ]; then
      echo "FAIL $rel is a SYMLINK — Turbopack refuses it (trap 2)"; bad=1
    elif [ ! -d "$WT/$rel" ]; then
      echo "FAIL $rel missing (trap 4)"; bad=1
    else
      echo "ok   $rel"
    fi
  done
  # TRAP 3(a): the stray nested tree that yields 1000+ null-useState failures.
  for rel in node_modules apps/docs/node_modules cloud/functions/node_modules; do
    if [ -d "$WT/$rel/node_modules" ]; then
      echo "FAIL $rel/node_modules exists — nested copy (trap 3a)"; bad=1
    fi
  done
  # TRAP 4: the three binaries whose absence is the actual observed symptom.
  for bin in node_modules/.bin/nx apps/docs/node_modules/.bin/docusaurus cloud/functions/node_modules/.bin/eslint; do
    if [ -x "$WT/$bin" ]; then echo "ok   $bin"; else echo "FAIL $bin not executable (trap 4)"; bad=1; fi
  done
  return $bad
}

# --- the gate-root lock ----------------------------------------------------
# TRAP 8 — TWO RUNS IN ONE GATE ROOT, and the second one resets the first's
# worktree out from under it (AGL-2561).
#
# `--affected` deliberately shares a STABLE root (see the GATE_ROOT block
# below), so any two fast runs land in the same `wt` — two sessions reaching
# for it at once, or one session that killed a run and relaunched it, which is
# routine. The entry-time `checkout --detach` + `reset --hard` + `clean -xdf`
# that correctly heals a tree a PREVIOUS run damaged is, against a run still in
# flight, the damage itself: it moves the tree to a different sha and discards
# whatever that run's tasks are mid-write. The first run keeps executing and
# reports a verdict for a tree it no longer controls, so a FALSE GREEN is
# reachable here, not only a false red. Nothing detected it and nothing warned.
#
# The lock is an atomic `mkdir` of `<root>/.lock` holding the owner's pid, its
# process start time, its ref and its sha. `mkdir` is the portable choice and
# not merely the cheap one: `flock(1)` is a util-linux program and is NOT
# installed on macOS, which is the only platform this gate runs on.
#
# EVERY root is locked, not only the shared fast one. A timestamped root
# collides with a second run started in the same second; `--root` is by
# definition a path two callers can name; and one unconditional code path is
# the version whose correctness does not depend on which flags were passed.
# On a root nobody else can be in, the lock costs one `mkdir` and always wins.
#
# The four properties that make it safe to rely on:
#   TAKEN BEFORE THE RESET   the acquisition sits above every write into the
#                            root — the summary truncation, the self-snapshot,
#                            and above all the entry-time `reset --hard`.
#   RELEASED ON EXIT         including INT/TERM/HUP, so a killed gate does not
#                            wedge the fast path for every later run.
#   STALE-CHECKED ON ENTRY   a lock whose owner is gone is reclaimed. Killing
#                            and relaunching a gate is routine, so a lock that
#                            could only be cleared by hand would be a worse
#                            bug than the one it fixes.
#   PID-REUSE PROOF          the owner's process START TIME is recorded beside
#                            its pid. A recycled pid looks alive to `kill -0`,
#                            and treating one as the holder would wedge the
#                            root exactly as badly as never releasing it.
#
# Everything from the marker below to its closing marker is self-contained:
# it reads no gate global, so the self-test extracts it and exercises it in a
# child shell against a throwaway root rather than against the real one, which
# a peer session may be using right now.
#
# >>> gate-root lock
GATE_LOCK_DIR="${GATE_LOCK_DIR:-}"
# EX_TEMPFAIL. The root is busy, which is a "try again", not a red verdict —
# and it must not collide with 64/65/66 or with a phase failure's 1.
GATE_LOCK_EXIT=75

gate_lock_field() { # gate_lock_field <lockdir> <key>
  sed -n "s/^$2=//p" "$1/owner" 2>/dev/null | head -1
}

gate_lock_proc_start() { # gate_lock_proc_start <pid>
  ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//;s/ *$//'
}

# A pid alone is not proof of life: pids are reused, and a recycled one would
# make a lock nobody holds look held forever. The recorded start time settles
# it. Missing evidence never downgrades a live pid to stale — `kill -0` said
# yes and that stands.
gate_lock_holder_alive() { # gate_lock_holder_alive <pid> <recorded start>
  local pid="$1" want="$2" now
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$pid" 2>/dev/null || return 1
  now=$(gate_lock_proc_start "$pid")
  [ -n "$want" ] && [ -n "$now" ] || return 0
  [ "$now" = "$want" ]
}

# The lock directory exists for an instant before its owner file does. A reader
# arriving inside that window sees no pid and must read it as HELD; reading it
# as stale would reclaim a lock that is about to be perfectly valid.
gate_lock_being_written() { # gate_lock_being_written <lockdir> <pid>
  [ -z "$2" ] || return 1
  [ -n "$(find "$1" -maxdepth 0 -mmin -1 2>/dev/null)" ]
}

# Written through a temp file and renamed, so a concurrent reader sees either
# the whole record or no record — never half a pid.
gate_lock_write() { # gate_lock_write <lockdir> <ref> <sha>
  { printf 'pid=%s\n'   "$$"
    printf 'start=%s\n' "$(gate_lock_proc_start "$$")"
    printf 'ref=%s\n'   "$2"
    printf 'sha=%s\n'   "$3"
    printf 'since=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  } > "$1/owner.tmp" 2>/dev/null && mv "$1/owner.tmp" "$1/owner" 2>/dev/null
  return 0
}

# The sha is not known at acquisition time — the lock has to be held before the
# ref is even resolved, because resolving it is followed immediately by the
# reset. It is filled in the moment it exists, so a run refused later names the
# commit the holder is gating rather than a placeholder.
gate_lock_note_sha() { # gate_lock_note_sha <sha>
  local owner
  [ -n "${GATE_LOCK_DIR:-}" ] || return 0
  [ "$(gate_lock_field "$GATE_LOCK_DIR" pid)" = "$$" ] || return 0
  owner="$GATE_LOCK_DIR/owner"
  sed "s|^sha=.*|sha=$1|" "$owner" > "$owner.tmp" 2>/dev/null \
    && mv "$owner.tmp" "$owner" 2>/dev/null
  return 0
}

# Reached through `trap`, which shellcheck cannot see as a call site.
# shellcheck disable=SC2329
gate_lock_release() {
  local lock="${GATE_LOCK_DIR:-}"
  [ -n "$lock" ] || return 0
  # Only the recorded owner removes it. A run whose lock was reclaimed while it
  # was alive must not delete the lock the reclaiming run now holds.
  if [ "$(gate_lock_field "$lock" pid)" = "$$" ]; then
    rm -rf "$lock"
  fi
  GATE_LOCK_DIR=""
  return 0
}

# Reached through `trap`, which shellcheck cannot see as a call site.
# shellcheck disable=SC2329
gate_lock_on_signal() { # gate_lock_on_signal <signal> <exit code>
  gate_lock_release
  echo "gate: $1 — gate-root lock released" >&2
  exit "$2"
}

gate_lock_arm_traps() {
  trap gate_lock_release EXIT
  trap 'gate_lock_on_signal INT 130' INT
  trap 'gate_lock_on_signal TERM 143' TERM
  trap 'gate_lock_on_signal HUP 129' HUP
}

# Names the pid AND the sha, because those are the two facts a human needs to
# decide between waiting and killing.
gate_lock_refuse() { # gate_lock_refuse <lockdir>
  local lock="$1"
  {
    echo "gate: REFUSING — this gate root is already held by another run."
    echo "      root         : $(dirname "$lock")"
    echo "      holder pid   : $(gate_lock_field "$lock" pid)"
    echo "      holder sha   : $(gate_lock_field "$lock" sha)"
    echo "      holder ref   : $(gate_lock_field "$lock" ref)"
    echo "      holding since: $(gate_lock_field "$lock" since)"
    echo
    echo "      Entering it would 'reset --hard' that run's worktree out from"
    echo "      under it. Both runs would then report a verdict for a tree"
    echo "      neither controls, and one of those verdicts can be green."
    echo
    echo "      Wait for it, re-run with --lock-wait <seconds> to queue behind"
    echo "      it, or kill the pid above — a lock whose owner is gone is"
    echo "      reclaimed automatically by the next run."
  } >&2
}

gate_lock_acquire() { # gate_lock_acquire <root> <ref> <wait seconds>
  local root="$1" ref="$2" budget="${3:-0}"
  local lock="$root/.lock" waited=0 reclaims=0 pid start

  case "$budget" in ''|*[!0-9]*) budget=0 ;; esac

  while : ; do
    if mkdir "$lock" 2>/dev/null; then
      GATE_LOCK_DIR="$lock"
      export GATE_LOCK_DIR
      gate_lock_write "$lock" "$ref" "(resolving)"
      return 0
    fi

    pid=$(gate_lock_field "$lock" pid)
    start=$(gate_lock_field "$lock" start)

    # The self-snapshot re-execs the SAME process into its copy, so the second
    # pass through here meets a lock this very pid already holds. Adopt it;
    # re-acquiring would deadlock the run against itself.
    if [ -n "$pid" ] && [ "$pid" = "$$" ]; then
      GATE_LOCK_DIR="$lock"
      export GATE_LOCK_DIR
      return 0
    fi

    if gate_lock_holder_alive "$pid" "$start" || gate_lock_being_written "$lock" "$pid"; then
      if [ "$waited" -ge "$budget" ]; then
        gate_lock_refuse "$lock"
        return "$GATE_LOCK_EXIT"
      fi
      sleep 2
      waited=$((waited + 2))
      continue
    fi

    # Stale. Reclaim by RENAME rather than by `rm -rf`: two runs can meet the
    # same stale lock, and only one of them can win a rename — the loser's `rm`
    # would otherwise delete the winner's brand-new lock and put both runs back
    # in the tree together, which is the bug this whole block exists to stop.
    reclaims=$((reclaims + 1))
    if [ "$reclaims" -gt 3 ]; then
      echo "gate: cannot reclaim the lock at $lock — remove it by hand" >&2
      return "$GATE_LOCK_EXIT"
    fi
    if mv "$lock" "$lock.stale.$$" 2>/dev/null; then
      echo "gate: reclaimed a stale lock at $lock (owner pid ${pid:-unknown} is gone)" >&2
      rm -rf "$lock.stale.$$"
    fi
  done
}
# <<< gate-root lock

# --- self-test -------------------------------------------------------------
# `verify_modules` is the guard that stands between a mis-provisioned worktree
# and a gate result that reads like a verdict. A guard nobody has ever seen
# fail is not a guard, so this builds each broken shape on purpose and asserts
# the refusal. Run by `npm run test:gate-script`.
self_test() {
  local tmp pass=0 fail=0
  tmp=$(mktemp -d)
  # shellcheck disable=SC2317
  _fixture() { # _fixture <dir> — a correctly provisioned worktree
    mkdir -p "$1/node_modules/.bin" "$1/apps/docs/node_modules/.bin" \
             "$1/cloud/functions/node_modules/.bin"
    touch "$1/node_modules/.bin/nx" "$1/apps/docs/node_modules/.bin/docusaurus" \
          "$1/cloud/functions/node_modules/.bin/eslint"
    chmod +x "$1/node_modules/.bin/nx" "$1/apps/docs/node_modules/.bin/docusaurus" \
             "$1/cloud/functions/node_modules/.bin/eslint"
  }
  _case() { # _case <label> <expected 0|1> <dir>
    WT="$3"
    local got
    # The label carries slashes, so it CANNOT be the filename: a failed
    # redirect makes bash skip the command and return 1 all by itself, which
    # silently "passed" every case whose expectation was 1. Derive the log
    # name from the fixture directory instead.
    local out="$tmp/$(basename "$3").log"
    verify_modules > "$out" 2>&1
    got=$?
    if [ "$got" = "$2" ]; then
      echo "ok   $1 (expected $2, got $got)"; pass=$((pass + 1))
    else
      echo "FAIL $1 (expected $2, got $got)"; sed 's/^/       /' "$out"; fail=$((fail + 1))
    fi
  }

  _fixture "$tmp/good"
  _case "a correctly provisioned tree passes" 0 "$tmp/good"

  # TRAP 2 — symlinked node_modules (Turbopack refuses it).
  _fixture "$tmp/symlink"; rm -rf "$tmp/symlink/node_modules"
  ln -s "$tmp/good/node_modules" "$tmp/symlink/node_modules"
  _case "a symlinked node_modules is refused" 1 "$tmp/symlink"

  # TRAP 3a — the stray nested tree (1000+ null-useState failures).
  _fixture "$tmp/nested"; mkdir -p "$tmp/nested/node_modules/node_modules"
  _case "a nested node_modules/node_modules is refused" 1 "$tmp/nested"

  # TRAP 4 — a missing standalone tree (docusaurus: command not found).
  _fixture "$tmp/nodocs"; rm -rf "$tmp/nodocs/apps/docs/node_modules"
  _case "a missing apps/docs tree is refused" 1 "$tmp/nodocs"

  _fixture "$tmp/nofn"; rm -rf "$tmp/nofn/cloud/functions/node_modules"
  _case "a missing cloud/functions tree is refused" 1 "$tmp/nofn"

  # TRAP 4 — present but not installed: the directory exists, the binary does not.
  _fixture "$tmp/nobin"; rm -f "$tmp/nobin/cloud/functions/node_modules/.bin/eslint"
  _case "an empty cloud/functions tree is refused" 1 "$tmp/nobin"

  # TRAP 5 — nx appends passthrough flags onto nx:run-commands targets, so the
  # lint and build phases must never carry one. Asserted against this file.
  local offenders
  offenders=$(grep -nE 'run "(lint|lint\(affected\)|build:[a-z]+)"' "$0" | grep -c 'maxWorkers')
  if [ "$offenders" = "0" ]; then
    echo "ok   no --maxWorkers on a shell-command phase"; pass=$((pass + 1))
  else
    echo "FAIL --maxWorkers reached a shell-command phase ($offenders)"; fail=$((fail + 1))
  fi

  # --- AGL-2486 additions -------------------------------------------------
  _assert() { # _assert <label> <expected> <actual>
    if [ "$2" = "$3" ]; then
      echo "ok   $1 ($3)"; pass=$((pass + 1))
    else
      echo "FAIL $1 (expected $2, got $3)"; fail=$((fail + 1))
    fi
  }

  # LOAD PARSING. A mis-parse is silent and reads as load 0, which puts a
  # box at load 245 in the `idle` band and re-buys the SIGTERM incident the
  # pin exists for. Both real formats, measured off real machines.
  _assert "macOS load format parses" "23.46" \
    "$(parse_load '23:11  up 10:09, 3 users, load averages: 23.46 27.49 24.56')"
  _assert "Linux load format parses" "0.52" \
    "$(parse_load ' 14:02:03 up 3 days,  2:11,  1 user,  load average: 0.52, 0.58, 0.59')"
  local live; live=$(load_1m)
  case "$live" in
    ''|*[!0-9.]*) echo "FAIL live uptime did not parse to a number ('$live')"; fail=$((fail + 1)) ;;
    *) echo "ok   live uptime parses to a number ($live)"; pass=$((pass + 1)) ;;
  esac

  # BAND SELECTION. The floor must be the OLD PIN or lower, so that adapting
  # can only ever make a loaded box calmer. The ceiling must actually rise on
  # an idle box, or nothing was gained.
  _band() { # _band <cores> <load> -> "<parallel>/<workers>"
    PARALLEL=auto; MAX_WORKERS=auto
    eval "cpu_count() { echo $1; }"
    eval "load_1m() { echo $2; }"
    choose_parallelism
    echo "$PARALLEL/$MAX_WORKERS"
  }
  _assert "a loaded box (10 cores, load 245) falls to the old pin or below" "2/2" "$(_band 10 245)"
  # The derived budgets must fall WITH the band. Deriving them as `p * 2` made
  # the loaded band pick 4 guards and 4 tsc — more than run-guards.mjs would
  # choose for itself and more than the old hardcoded typecheck pool, so the
  # gate got LESS conservative under load than the thing it was overriding.
  _budgets() { PARALLEL=auto; MAX_WORKERS=auto
    eval "cpu_count() { echo $1; }"; eval "load_1m() { echo $2; }"
    choose_parallelism; echo "$GUARD_CONCURRENCY/$TYPECHECK_CONCURRENCY"; }
  _assert "a loaded box gets the SMALLEST guard and tsc budgets" "2/2" "$(_budgets 10 245)"
  _assert "an idle box gets the LARGEST guard and tsc budgets"   "8/8" "$(_budgets 10 0.5)"
  _assert "tonight's box (10 cores, load 21) falls to the old pin or below"  "2/2" "$(_band 10 21)"
  _assert "a busy box (10 cores, load 9) gets the old pin"                   "3/2" "$(_band 10 9)"
  _assert "an idle box (10 cores, load 0.5) uses the machine"                "6/4" "$(_band 10 0.5)"
  _assert "parallelism never exceeds the core count"                         "2/4" "$(_band 2 0.1)"
  # An explicit pin must survive the adaptation, or GATE_PARALLEL is a lie.
  PARALLEL=3; MAX_WORKERS=1
  eval "load_1m() { echo 0.1; }"; eval "cpu_count() { echo 10; }"
  choose_parallelism
  _assert "an explicit --parallel/--max-workers is NOT overridden" "3/1" "$PARALLEL/$MAX_WORKERS"
  unset -f cpu_count load_1m

  # TRAP 7 — the self-snapshot. Editing this file while a run is in flight
  # corrupts that run, because bash reads a script lazily by byte offset. It
  # cost two real runs on 2026-08-22, one of them another agent's. Asserted
  # against this file's own text: the claim is only true while the lines that
  # implement it are present.
  for _need in 'GATE_SNAPSHOT' 'exec bash "\$GATE_SNAPSHOT_PATH"' 'GATE_SOURCE_REPO'; do
    if grep -q "$_need" "$0"; then
      echo "ok   self-snapshot: $_need present"; pass=$((pass + 1))
    else
      echo "FAIL self-snapshot: $_need MISSING — runs are editable mid-flight"; fail=$((fail + 1))
    fi
  done
  # SOURCE_REPO must prefer the inherited value, or the re-exec'd copy resolves
  # the repo root to the gate root and every path after it is wrong.
  if grep -q 'SOURCE_REPO="\${GATE_SOURCE_REPO:-' "$0"; then
    echo "ok   the snapshot inherits SOURCE_REPO rather than deriving it"; pass=$((pass + 1))
  else
    echo "FAIL the snapshot would derive SOURCE_REPO from its own location"; fail=$((fail + 1))
  fi

  # TRAP 6 — PROVISIONING PLAN. The gate clones node_modules and never
  # installed, so gating any lockfile change compiled against the OLD packages
  # and printed exit 0. Every branch asserted here, including the two that
  # would otherwise need a network and several minutes to reach.
  _assert "matching lockfiles clone from the source checkout" "source" \
    "$(provision_plan aaa aaa 0 1)"
  _assert "a drifted lockfile with a cached tree uses the cache" "cache" \
    "$(provision_plan aaa bbb 1 1)"
  _assert "a drifted lockfile with no cache INSTALLS" "install" \
    "$(provision_plan aaa bbb 0 1)"
  _assert "a drifted lockfile REFUSES when installing is off" "refuse" \
    "$(provision_plan aaa bbb 0 0)"
  # The bug in its exact shape: differing hashes must never yield `source`.
  # This is the assertion that would have failed before the fix.
  _assert "a drifted lockfile NEVER clones the stale tree" "install" \
    "$(provision_plan 15211ac 15201de 0 1)"
  # An unresolvable lockfile is a refusal, not a shrug that falls through.
  _assert "an unresolvable lockfile refuses" "refuse" "$(provision_plan unknown aaa 1 1)"
  _assert "an empty lockfile hash refuses" "refuse" "$(provision_plan '' aaa 1 1)"
  # --no-install must not be able to produce a clone of the wrong tree; the
  # only two outcomes it permits on drift are a keyed cache hit or a refusal.
  for _h in 0 1; do
    case "$(provision_plan aaa bbb $_h 0)" in
      source|install) echo "FAIL --no-install produced a wrong plan (cache_hit=$_h)"; fail=$((fail + 1)) ;;
      *) pass=$((pass + 1)) ;;
    esac
  done
  echo "ok   --no-install never clones a mismatched tree (both cache states)"
  # The npm cache must be gate-owned. `npm ci` against ~/.npm/_cacache fails
  # EACCES on root-owned entries left by a past sudo install, and the fix for
  # that must never be chown on somebody's home directory.
  case "$NPM_CACHE_HOME" in
    "$HOME"/*) echo "FAIL the npm cache points into \$HOME ($NPM_CACHE_HOME)"; fail=$((fail + 1)) ;;
    /*) echo "ok   the npm cache is gate-owned ($NPM_CACHE_HOME)"; pass=$((pass + 1)) ;;
    *) echo "FAIL the npm cache path is not absolute"; fail=$((fail + 1)) ;;
  esac
  # All three trees have a lockfile to reason about. A tree whose lockfile this
  # script names wrongly would silently take the `unknown` -> refuse path.
  for _l in package-lock.json apps/docs/package-lock.json cloud/functions/package-lock.json; do
    if [ -f "$SOURCE_REPO/$_l" ] && grep -q "$_l" "$0"; then
      echo "ok   $_l exists and is named by the gate"; pass=$((pass + 1))
    else
      echo "FAIL $_l missing or not named by the gate"; fail=$((fail + 1))
    fi
  done

  # PROJECT-LIST PARSING. `nx show projects` prints a JSON array into a pipe
  # and one name per line on a TTY. Getting this wrong made a one-file change
  # under apps/tenant report "NO app affected" and skip the tenant production
  # build — the fast path proving LESS than it said. Both real shapes.
  _assert "nx JSON array parses" "tenant tenant-e2e" \
    "$(normalize_projects '["tenant","tenant-e2e"]')"
  _assert "newline-separated list parses" "tenant tenant-e2e" \
    "$(normalize_projects 'tenant
tenant-e2e')"
  _assert "an empty list stays empty" "" "$(normalize_projects '[]')"
  # The membership test the build phase actually performs, on real output.
  _apps() { local out="" a; for a in console tenant docs; do
      case " $(normalize_projects "$1") " in *" $a "*) out="$out $a" ;; esac
    done; echo "${out# }"; }
  _assert "a tenant-only diff selects the tenant production build" "tenant" \
    "$(_apps '["tenant","tenant-e2e"]')"
  _assert "a tools-only diff selects no production build" "" "$(_apps '[]')"
  _assert "a two-app diff selects both" "console tenant" \
    "$(_apps '["console","tenant","aglyn"]')"

  # --fresh-cache MUST NOT delete the shared cache. Now that the cache is
  # stable and shared between gate runs, `rm -rf "$NX_CACHE_DIRECTORY"` would
  # clear one another gate is actively writing into — TRAP 1's incident,
  # reproduced by the very change that made the cache warm. Asserted as the
  # absence of an rm against the shared path, and the presence of a private one.
  if grep -q 'rm -rf "\$NX_CACHE_DIRECTORY"' "$0" && ! grep -q 'nx-cache-fresh' "$0"; then
    echo "FAIL --fresh-cache deletes the SHARED nx cache (trap 1 on another run)"; fail=$((fail + 1))
  else
    echo "ok   --fresh-cache uses a private cache, never deleting the shared one"; pass=$((pass + 1))
  fi

  # THE FAST PATH'S HONESTY. These assert against this file's own text: the
  # claims are only true while the lines that implement them are present.
  if grep -q 'build: NO app affected' "$0"; then
    echo "ok   a zero-build affected run says so in words"; pass=$((pass + 1))
  else
    echo "FAIL nothing reports an affected run that built no app"; fail=$((fail + 1))
  fi
  if grep -q 'PATH: FAST' "$0" && grep -q 'PATH: FULL' "$0"; then
    echo "ok   the summary names which path ran"; pass=$((pass + 1))
  else
    echo "FAIL the summary does not name which path ran"; fail=$((fail + 1))
  fi
  # The guards phase must never be narrowed by --affected. Asserted as the
  # ABSENCE of an --only on the gate's own guards invocation, because that is
  # the single edit that would silently reintroduce the narrowing.
  if grep -E '^[[:space:]]+run "guards"' "$0" | grep -q -- '--only'; then
    echo "FAIL the gate narrows its guards phase"; fail=$((fail + 1))
  else
    echo "ok   the guards phase is never narrowed by the gate"; pass=$((pass + 1))
  fi
  # typecheck must never be affected-scoped: the 2026-08-22 spec-tsconfig
  # failure is precisely what a narrowed type gate misses.
  if grep -E '^[[:space:]]+run "typecheck"' "$0" | grep -q -- '--changed\|affected'; then
    echo "FAIL the gate's typecheck phase is scoped"; fail=$((fail + 1))
  else
    echo "ok   the typecheck phase is whole-workspace on both paths"; pass=$((pass + 1))
  fi

  # --- AGL-2561: the gate-root lock ---------------------------------------
  # Every case here runs against a THROWAWAY root under $tmp. Pointing them at
  # the real /private/tmp/aglyn-gate/fast would reproduce the very bug — a peer
  # session may be holding it right now.
  #
  # The lock block is self-contained by construction, so it is extracted and
  # sourced in a child shell. That buys the two cases a same-process test
  # cannot reach at all: release on normal exit, and release on SIGTERM.
  local _lockmod="$tmp/lock.sh" _lockroot _lockout _lockrc _holder _dead
  sed -n '/^# >>> gate-root lock$/,/^# <<< gate-root lock$/p' "$0" > "$_lockmod"
  if [ -s "$_lockmod" ] && bash -n "$_lockmod" 2>/dev/null; then
    echo "ok   the lock block extracts and parses on its own"; pass=$((pass + 1))
  else
    echo "FAIL the lock block could not be extracted from $0"; fail=$((fail + 1))
  fi

  _lock_child() { # _lock_child <script body> <args...> — sources the block first
    local body="$1"; shift
    bash -c '. "$0"; '"$body" "$_lockmod" "$@"
  }

  # ORDERING — the hard requirement. A lock taken after the reset protects
  # nothing, and the reset is what destroys the other run's tree.
  local _acq_line _reset_line
  _acq_line=$(grep -n '^gate_lock_acquire "\$GATE_ROOT"' "$0" | head -1 | cut -d: -f1)
  _reset_line=$(grep -n 'reset --hard "\$GATE_SHA"' "$0" | head -1 | cut -d: -f1)
  if [ -n "$_acq_line" ] && [ -n "$_reset_line" ] && [ "$_acq_line" -lt "$_reset_line" ]; then
    echo "ok   the lock is taken before the entry-time reset --hard"; pass=$((pass + 1))
  else
    echo "FAIL the entry-time reset --hard can run unlocked"; fail=$((fail + 1))
  fi

  # A FREE ROOT is simply taken.
  _lockroot="$tmp/lock-free"; mkdir -p "$_lockroot"
  _lock_child 'gate_lock_acquire "$1" origin/main 0' "$_lockroot" >/dev/null 2>&1
  _assert "a free root is locked" "0" "$?"

  # A HELD ROOT is refused, and the refusal names the pid AND the sha. The
  # holder is a real, live process, because a fake pid proves nothing about
  # the liveness check.
  _lockroot="$tmp/lock-held"; mkdir -p "$_lockroot/.lock"
  sleep 30 & _holder=$!
  { printf 'pid=%s\n' "$_holder"
    printf 'start=%s\n' "$(gate_lock_proc_start "$_holder")"
    printf 'ref=%s\n' "origin/production"
    printf 'sha=%s\n' "c0ffee1"
    printf 'since=%s\n' "2026-09-03 18:44:01"
  } > "$_lockroot/.lock/owner"
  _lockout=$(_lock_child 'gate_lock_acquire "$1" origin/main 0' "$_lockroot" 2>&1)
  _lockrc=$?
  _assert "a held root is refused, not entered" "75" "$_lockrc"
  case "$_lockout" in
    *"$_holder"*) echo "ok   the refusal names the holding pid ($_holder)"; pass=$((pass + 1)) ;;
    *) echo "FAIL the refusal does not name the holding pid"; fail=$((fail + 1)) ;;
  esac
  case "$_lockout" in
    *c0ffee1*) echo "ok   the refusal names the holding sha"; pass=$((pass + 1)) ;;
    *) echo "FAIL the refusal does not name the holding sha"; fail=$((fail + 1)) ;;
  esac
  # And it must not have touched the holder's lock on its way out.
  if [ "$(gate_lock_field "$_lockroot/.lock" pid)" = "$_holder" ]; then
    echo "ok   a refused run leaves the holder's lock intact"; pass=$((pass + 1))
  else
    echo "FAIL a refused run damaged the lock it was refused by"; fail=$((fail + 1))
  fi

  # --lock-wait QUEUES instead of refusing immediately. Asserted as elapsed
  # time, because a budget that is read but never slept on looks identical.
  local _t0 _t1
  _t0=$(date +%s)
  _lock_child 'gate_lock_acquire "$1" origin/main 2' "$_lockroot" >/dev/null 2>&1
  _lockrc=$?
  _t1=$(date +%s)
  _assert "--lock-wait still refuses when the budget runs out" "75" "$_lockrc"
  if [ $((_t1 - _t0)) -ge 2 ]; then
    echo "ok   --lock-wait actually waits ($((_t1 - _t0))s)"; pass=$((pass + 1))
  else
    echo "FAIL --lock-wait returned instantly; the budget is ignored"; fail=$((fail + 1))
  fi
  kill "$_holder" 2>/dev/null; wait "$_holder" 2>/dev/null

  # A STALE lock — owner pid gone — is reclaimed. Killing and relaunching a
  # gate is routine, so this is the difference between a lock and a wedge.
  _lockroot="$tmp/lock-stale"; mkdir -p "$_lockroot/.lock"
  ( exit 0 ) & _dead=$!; wait "$_dead" 2>/dev/null
  { printf 'pid=%s\n' "$_dead"
    printf 'start=%s\n' "Wed Sep  3 18:44:01 2026"
    printf 'ref=%s\n' "origin/main"
    printf 'sha=%s\n' "deadbee"
    printf 'since=%s\n' "2026-09-03 18:44:01"
  } > "$_lockroot/.lock/owner"
  _lockout=$(_lock_child 'gate_lock_acquire "$1" origin/main 0' "$_lockroot" 2>&1)
  _lockrc=$?
  _assert "a stale lock is reclaimed, not obeyed forever" "0" "$_lockrc"
  case "$_lockout" in
    *reclaimed*) echo "ok   the reclaim says so out loud"; pass=$((pass + 1)) ;;
    *) echo "FAIL a stale lock was reclaimed silently"; fail=$((fail + 1)) ;;
  esac

  # A RECYCLED PID looks alive to `kill -0`. Without the recorded start time
  # this wedges the root exactly as badly as never releasing the lock.
  _lockroot="$tmp/lock-recycled"; mkdir -p "$_lockroot/.lock"
  sleep 30 & _holder=$!
  { printf 'pid=%s\n' "$_holder"
    printf 'start=%s\n' "Thu Jan  1 00:00:00 1970"
    printf 'ref=%s\n' "origin/main"
    printf 'sha=%s\n' "deadbee"
    printf 'since=%s\n' "1970-01-01 00:00:00"
  } > "$_lockroot/.lock/owner"
  _lock_child 'gate_lock_acquire "$1" origin/main 0' "$_lockroot" >/dev/null 2>&1
  _assert "a recycled pid does not hold the root hostage" "0" "$?"
  kill "$_holder" 2>/dev/null; wait "$_holder" 2>/dev/null

  # RELEASE ON NORMAL EXIT. The lock must not outlive the run that took it.
  _lockroot="$tmp/lock-exit"; mkdir -p "$_lockroot"
  _lock_child 'gate_lock_acquire "$1" origin/main 0 && gate_lock_arm_traps; exit 0' \
    "$_lockroot" >/dev/null 2>&1
  if [ -d "$_lockroot/.lock" ]; then
    echo "FAIL the lock survived a normal exit"; fail=$((fail + 1))
  else
    echo "ok   the lock is released on normal exit"; pass=$((pass + 1))
  fi

  # RELEASE ON SIGTERM. The near-miss in AGL-2561 was one session killing its
  # own gate twice and relaunching into the same root, so this is the signal
  # that actually happens here.
  # Backgrounded DIRECTLY rather than through _lock_child: backgrounding a
  # shell function forks a subshell, `$!` would be that subshell's pid, and the
  # SIGTERM would never reach the process actually holding the lock — the test
  # would then report a wedge that is only an artifact of how it was launched.
  _lockroot="$tmp/lock-term"; mkdir -p "$_lockroot"
  bash -c '. "$0"; gate_lock_acquire "$1" origin/main 0 >/dev/null 2>&1 && gate_lock_arm_traps
           : > "$1.ready"; while : ; do sleep 0.2; done' \
    "$_lockmod" "$_lockroot" >/dev/null 2>&1 &
  _holder=$!
  local _spins=0
  while [ ! -f "$_lockroot.ready" ] && [ "$_spins" -lt 50 ]; do
    sleep 0.1; _spins=$((_spins + 1))
  done
  if [ -d "$_lockroot/.lock" ]; then
    kill -TERM "$_holder" 2>/dev/null
    wait "$_holder" 2>/dev/null
    _spins=0
    while [ -d "$_lockroot/.lock" ] && [ "$_spins" -lt 30 ]; do sleep 0.1; _spins=$((_spins + 1)); done
    if [ -d "$_lockroot/.lock" ]; then
      echo "FAIL the lock survived SIGTERM — the fast root would be wedged"; fail=$((fail + 1))
    else
      echo "ok   the lock is released on SIGTERM"; pass=$((pass + 1))
    fi
  else
    kill -TERM "$_holder" 2>/dev/null; wait "$_holder" 2>/dev/null
    echo "FAIL the SIGTERM fixture never took the lock"; fail=$((fail + 1))
  fi

  # A RUN THAT LOST ITS LOCK must not delete the reclaiming run's. Otherwise
  # the release path itself puts two runs back in one tree.
  _lockroot="$tmp/lock-notmine"; mkdir -p "$_lockroot/.lock"
  printf 'pid=999999\nstart=x\nref=r\nsha=s\nsince=t\n' > "$_lockroot/.lock/owner"
  _lock_child 'GATE_LOCK_DIR="$1/.lock"; gate_lock_release' "$_lockroot" >/dev/null 2>&1
  if [ -d "$_lockroot/.lock" ]; then
    echo "ok   a run only releases a lock it still owns"; pass=$((pass + 1))
  else
    echo "FAIL the release path deletes another run's lock"; fail=$((fail + 1))
  fi

  # EVERY root is claimed, not only the shared fast one: a single call site, at
  # column zero, so it sits inside no `if` and its reach cannot depend on which
  # flags were passed. A timestamped root collides with a run started in the
  # same second and `--root` is a path two callers can name, so the uniform
  # version is both the simpler one and the strictly more correct one.
  if [ "$(grep -c 'gate_lock_acquire "\$GATE_ROOT"' "$0")" = "1" ] \
     && grep -q '^gate_lock_acquire "\$GATE_ROOT"' "$0"; then
    echo "ok   the root is claimed once, unconditionally"; pass=$((pass + 1))
  else
    echo "FAIL the claim is conditional, or made from more than one place"; fail=$((fail + 1))
  fi
  # THE GUARD RUNNER's own self-test, delegated. gate.sh's guards phase is now
  # one call into that script, so its derivation is part of this gate's
  # correctness and a green here must depend on a green there.
  if node "$SOURCE_REPO/tools/scripts/run-guards.mjs" --self-test >"$tmp/guards.log" 2>&1; then
    echo "ok   run-guards.mjs self-test"; pass=$((pass + 1))
  else
    echo "FAIL run-guards.mjs self-test"; sed 's/^/       /' "$tmp/guards.log"; fail=$((fail + 1))
  fi

  rm -rf "$tmp"
  echo "self-test: $pass passed, $fail failed"
  [ "$fail" = 0 ] || return 1
  return 0
}

if [ "$SELF_TEST" = 1 ]; then
  self_test
  exit $?
fi
# A FULL gate gets a fresh timestamped root: it is the promotion artifact, its
# logs are read afterwards, and two of them may run at once.
#
# The FAST path gets a STABLE root instead, because its whole purpose is a
# second run minutes after the first and the provisioning it would repeat is
# `cp -Rc` of three node_modules trees — 1m35s of the 15m20s baseline, spent
# reproducing a directory that is already correct. Reuse is opt-out via
# --root, and it is safe to reuse for the reason below: the worktree is
# re-checked-out to the new SHA and the module trees are re-provisioned the
# moment package-lock.json moves.
if [ -z "$GATE_ROOT" ]; then
  if [ "$AFFECTED" = 1 ]; then
    GATE_ROOT="/private/tmp/aglyn-gate/fast"
    REUSING=1
  else
    GATE_ROOT="/private/tmp/aglyn-gate/$(date +%Y%m%d-%H%M%S)"
    REUSING=0
  fi
else
  REUSING=0
fi
WT="$GATE_ROOT/wt"
LOGS="$GATE_ROOT/logs"
EXITS="$GATE_ROOT/exit"
SUMMARY="$GATE_ROOT/summary.txt"

mkdir -p "$LOGS" "$EXITS"

# --- claim the root --------------------------------------------------------
# TRAP 8. This line sits above EVERYTHING that writes into the gate root: the
# summary truncation, the self-snapshot, and the entry-time `reset --hard` that
# would otherwise land on a worktree another run is still using. Ordering is
# the whole property — a lock taken after the reset protects nothing.
gate_lock_acquire "$GATE_ROOT" "$REF" "$GATE_LOCK_WAIT" || exit $?
gate_lock_arm_traps

# --- self-snapshot ---------------------------------------------------------
# TRAP 7 — bash reads a script LAZILY, BY BYTE OFFSET, as it executes it.
#
# Edit tools/gate.sh while a run is in flight and the running shell resumes at
# the byte offset it had reached, now pointing into different text. The symptom
# is a syntax error on a line number that has nothing wrong with it:
#
#     tools/gate.sh: line 713: —: command not found
#
# ...on a run that had already passed typecheck cleanly. It happened twice on
# 2026-08-22 — once to this author's own measurement run, once to another
# agent's — and it costs whatever the run had completed. A corrupted run is not
# a red anyone can interpret; it is noise wearing a verdict's exit code, which
# is the single failure mode this whole script exists to prevent.
#
# Five or more agents share this checkout and several of them run gates, so
# "just do not edit it" is not a property anyone can hold. Telling every caller
# to copy the script first works and puts the burden in the wrong place. The
# gate snapshots ITSELF into its own gate root and re-execs the copy: from that
# moment the run is immune to any edit of the source file, and no caller has to
# know the hazard exists.
#
# GATE_SNAPSHOT stops the recursion; GATE_SOURCE_REPO carries the real repo
# path, which the copy could not otherwise derive from its own location.
if [ -z "${GATE_SNAPSHOT:-}" ]; then
  GATE_SNAPSHOT_PATH="$GATE_ROOT/gate.snapshot.sh"
  if cp "$SELF_PATH" "$GATE_SNAPSHOT_PATH" 2>/dev/null; then
    export GATE_SNAPSHOT=1
    export GATE_SOURCE_REPO="$SOURCE_REPO"
    # bash 3.2 (the macOS default) treats an EMPTY array's `[@]` as unbound
    # under `set -u`, so a bare `tools/gate.sh` — the documented invocation —
    # died here before running a single phase. The `+` form expands to nothing
    # when the array is empty instead of erroring.
    exec bash "$GATE_SNAPSHOT_PATH" ${GATE_ORIG_ARGS[@]+"${GATE_ORIG_ARGS[@]}"}
  fi
  # A failed copy is not fatal — it just means this run keeps the old hazard.
  # Say so, rather than pretending the protection is in place.
  echo "gate: WARNING could not snapshot to $GATE_SNAPSHOT_PATH;" >&2
  echo "      this run is NOT protected against edits to tools/gate.sh." >&2
fi
: > "$SUMMARY"

log() { printf '%s\n' "$*" | tee -a "$SUMMARY"; }

# --- phase runner ----------------------------------------------------------
PHASE_NAMES=()
PHASE_CODES=()

run() { # run <name> <command...>
  local name="$1"; shift
  local file="${name//[:\/ ]/_}"
  local code
  log ">>> $name  $(date +%H:%M:%S)"
  "$@" > "$LOGS/$file.log" 2>&1
  code=$?                 # BARE. Nothing may come between these two lines.
  printf '%s\n' "$code" > "$EXITS/$file"
  PHASE_NAMES+=("$name")
  PHASE_CODES+=("$code")
  log "<<< $name EXIT=$code  $(date +%H:%M:%S)  ($LOGS/$file.log)"
  return 0
}

wants() { case ",$PHASES," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }

# --- 0. provision ----------------------------------------------------------
log "=== gate $(date '+%Y-%m-%d %H:%M:%S') ==="
log "source repo : $SOURCE_REPO"
log "gate root   : $GATE_ROOT"

git -C "$SOURCE_REPO" fetch origin --quiet 2>/dev/null
GATE_SHA=$(git -C "$SOURCE_REPO" rev-parse "$REF" 2>/dev/null) || {
  echo "gate: cannot resolve ref '$REF'" >&2
  # Do not leave a gate root behind for a run that never started.
  [ -d "$WT" ] || rm -rf "$GATE_ROOT"
  exit 65
}
log "gating ref  : $REF  ->  $GATE_SHA"
# The lock was taken before the ref could be resolved. Record the sha now, so a
# run refused against this root names the commit being gated rather than a
# placeholder — that is half of what tells the reader to wait or to kill.
gate_lock_note_sha "$GATE_SHA"

if [ ! -d "$WT" ]; then
  # --detach: the gate must never move a branch anyone else is standing on.
  git -C "$SOURCE_REPO" worktree add --detach "$WT" "$GATE_SHA" >/dev/null 2>&1 \
    || { echo "gate: worktree add failed" >&2; exit 66; }
  REUSED_WT=0
else
  # A reused root points at the PREVIOUS run's SHA. Move it, and move it
  # HARD: `checkout --detach` alone leaves any file a failed run modified, and
  # `git clean -xdff` would delete the three node_modules trees this reuse
  # exists to keep. So reset tracked files and clean untracked ones while
  # excluding the module trees by name.
  git -C "$WT" checkout --detach "$GATE_SHA" >/dev/null 2>&1 \
    || { echo "gate: cannot re-checkout $GATE_SHA in $WT — remove $GATE_ROOT and retry" >&2; exit 66; }
  git -C "$WT" reset --hard "$GATE_SHA" >/dev/null 2>&1
  git -C "$WT" clean -xdf \
    -e node_modules -e apps/docs/node_modules -e cloud/functions/node_modules \
    >/dev/null 2>&1
  REUSED_WT=1
fi
log "worktree at : $WT ($(git -C "$WT" rev-parse HEAD))$([ "$REUSED_WT" = 1 ] && echo ' [reused]')"

# Re-provision only when the module trees are absent or package-lock.json has
# moved. The stamp is the lock file's BLOB HASH, not its mtime: a reused
# worktree gets a fresh checkout of the lock file on every run, so mtime always
# looks new and would defeat the reuse entirely.
# Per tree, and per LOCKFILE. Each of the three has its own lockfile and its
# own answer: a root dependency bump must not force apps/docs to reinstall.
export NPM_CONFIG_CACHE="$NPM_CACHE_HOME"
mkdir -p "$NPM_CACHE_HOME" "$MODULES_CACHE"

provision_one() { # provision_one <slug> <lockrel> <modrel>
  if [ "$REUSED_WT" = 1 ] && provision_reusable "$1" "$2" "$3"; then
    log "provision   : $1 REUSED (installed for this exact $2)"
    PROVISION_NOTE="$PROVISION_NOTE $1=reused"
    return 0
  fi
  run "provision:$1" provision_tree "$1" "$2" "$3"
}

provision_one root      package-lock.json                     node_modules
provision_one docs      apps/docs/package-lock.json           apps/docs/node_modules
provision_one functions cloud/functions/package-lock.json     cloud/functions/node_modules

# verify_modules runs on EVERY path, reused or freshly cloned. It is the guard
# that stands between a mis-provisioned worktree and a result that reads like a
# verdict, and a reused tree is exactly where a half-deleted node_modules would
# survive unnoticed.
run "provision:verify"    verify_modules

# --- isolated environment --------------------------------------------------
# TRAP 1. NX_CACHE_DIRECTORY is the one that a worktree does NOT give you.
# TRAP 1's fix was NX_CACHE_DIRECTORY, and it was pointed at "$GATE_ROOT/nx-cache".
# GATE_ROOT defaults to a TIMESTAMPED directory, so every gate run started from
# an empty cache — measured on 2026-08-22 as `console:test` 7/35 hits (20%) and
# nx's own report of 3m23s recoverable, 52% of the run.
#
# That conflated two different isolations. What TRAP 1 requires is isolation
# from THE SHARED CHECKOUT's `.nx/cache`, because other agents clear that one
# mid-run and nx then dies reaching for a file it just wrote. It never required
# isolation between gate runs — and isolation between gate runs is the one that
# costs, because nx's cache is content-addressed by task hash, so a previous
# gate's results are exactly what makes this gate fast.
#
# So the cache lives at a STABLE path, outside the source checkout and outside
# any per-run root. Runs stay isolated from the shared checkout (the assertion
# at the bottom of this file still proves that, bare) and warm across each
# other. `--fresh-cache` gives a run its OWN empty cache under the gate root
# rather than deleting this one — see the block below, where that distinction
# is the difference between isolation and reproducing TRAP 1 on somebody else.
NX_CACHE_HOME="${GATE_NX_CACHE:-/private/tmp/aglyn-gate/nx-cache}"
export NX_CACHE_DIRECTORY="$NX_CACHE_HOME"
export NX_DAEMON=false
# NPM_CONFIG_CACHE is exported at provisioning time (it has to be set before
# any `npm ci` runs) and points at the stable, gate-owned cache.
export NODE_OPTIONS="--max-old-space-size=8192"
export CI=true
# --fresh-cache gets a PRIVATE cache directory; it never deletes the shared one.
#
# `rm -rf "$NX_CACHE_DIRECTORY"` was correct while that directory was per-run.
# Now that it is stable and shared between gate runs, deleting it would clear a
# cache another gate is actively writing into — which is TRAP 1's incident
# exactly, reproduced by the change that made the cache warm. The observed
# symptom there was nx dying on a file it had just written, the test phase
# aborting after 18 of 40 projects, and the run still printing an exit code
# that read like a verdict.
#
# A run that wants to distrust the cache wants its own empty one; it does not
# want every other gate's cache deleted. Same isolation, none of the collateral.
CACHE_NOTE="shared, warm"
if [ "$FRESH_CACHE" = 1 ]; then
  export NX_CACHE_DIRECTORY="$GATE_ROOT/nx-cache-fresh"
  rm -rf "$NX_CACHE_DIRECTORY"
  CACHE_NOTE="PRIVATE and empty (--fresh-cache)"
fi
mkdir -p "$NX_CACHE_DIRECTORY" "$NPM_CONFIG_CACHE"
log "nx cache    : $NX_CACHE_DIRECTORY ($CACHE_NOTE)"
cd "$WT" || exit 67

# Prove the isolation instead of trusting it: nothing this run does may appear
# in the shared checkout's .nx. Recorded before and after as a bare comparison.
SHARED_NX_BEFORE=$(find "$SOURCE_REPO/.nx/cache" -type f 2>/dev/null | wc -l | tr -d ' ')

# --- parallelism -----------------------------------------------------------
choose_parallelism
log "parallelism : $PARALLELISM_NOTE"
# GUARD_CONCURRENCY and TYPECHECK_CONCURRENCY come out of choose_parallelism
# above, off the SAME load reading as --parallel. Both scripts can read the
# load themselves; letting them would have each phase adapt to a different
# reading taken at a different moment, and the gate would have no single
# answer to "how busy did this run think the box was".
log "budgets     : guards=$GUARD_CONCURRENCY tsc=$TYPECHECK_CONCURRENCY"

# --- affected scope --------------------------------------------------------
# Resolved ONCE, here, so every phase narrows against the same answer and the
# summary can state it. `nx affected` needs a base; for a gate the honest base
# is the last thing that was actually promoted, which is `origin/production` —
# not the previous commit. A hot fix is usually one commit but the gate root is
# a detached worktree at an arbitrary ref, and basing on HEAD~1 would gate only
# the newest commit of however many have landed since the last release.
AFFECTED_PROJECTS=""
AFFECTED_APPS=""
AFFECTED_NOTE=""
if [ "$AFFECTED" = 1 ]; then
  [ -n "$AFFECTED_BASE" ] || AFFECTED_BASE="origin/production"
  if ! git -C "$WT" rev-parse --verify --quiet "$AFFECTED_BASE" >/dev/null; then
    log "FAIL: --affected base '$AFFECTED_BASE' does not resolve in the gate worktree."
    log "      Refusing to guess. Pass --base <ref>, or run the FULL gate."
    exit 68
  fi
  AFFECTED_BASE_SHA=$(git -C "$WT" rev-parse "$AFFECTED_BASE")
  AFFECTED_PROJECTS=$(normalize_projects "$(npx nx show projects --affected --base="$AFFECTED_BASE_SHA" --head="$GATE_SHA" 2>/dev/null)")
  # An empty answer is ambiguous — it is either "nothing changed" or "nx could
  # not read the graph". Distinguish them, because the second one silently
  # gates nothing while exiting 0.
  if [ -z "$(echo "$AFFECTED_PROJECTS" | tr -d ' ')" ]; then
    if npx nx show projects >/dev/null 2>&1; then
      AFFECTED_NOTE="nx read the graph and reports NO affected project"
    else
      log "FAIL: nx cannot read the project graph — an affected scope cannot be trusted."
      exit 69
    fi
  fi
  for app in console tenant docs; do
    case " $AFFECTED_PROJECTS " in *" $app "*) AFFECTED_APPS="$AFFECTED_APPS $app" ;; esac
  done
  AFFECTED_APPS=$(echo "$AFFECTED_APPS" | tr -s ' ' | sed 's/^ //;s/ $//')
  log ""
  log "=== FAST PATH: --affected (a WEAKER claim than the full gate) ==="
  log "base        : $AFFECTED_BASE -> $AFFECTED_BASE_SHA"
  log "affected    : $(echo "$AFFECTED_PROJECTS" | wc -w | tr -d ' ') project(s)${AFFECTED_NOTE:+ — $AFFECTED_NOTE}"
  log "  $AFFECTED_PROJECTS"
  log "affected apps (production builds): ${AFFECTED_APPS:-NONE}"
  log "NOT narrowed: typecheck, docs:typecheck, and EVERY guard ($(node tools/scripts/run-guards.mjs --list | wc -l | tr -d ' '))"
  log ""
fi

# --- phases ----------------------------------------------------------------
if wants typecheck; then
  # The workspace's ONLY type gate — builds transpile with swc and never
  # type-check. apps/docs is excluded from the sweep by name (it is a
  # standalone package with its own TypeScript), so it needs its own target.
  run "typecheck"      npm run typecheck
  run "typecheck:docs" npx nx run docs:typecheck
fi

if wants lint; then
  # TRAP 5: --parallel only. NO --maxWorkers here: cloud-functions:lint is an
  # nx:run-commands target and the flag lands inside its /bin/sh string.
  if [ "$AFFECTED" = 1 ]; then
    run "lint(affected)" npx nx affected -t lint --base="$AFFECTED_BASE_SHA" --head="$GATE_SHA" --parallel="$PARALLEL" --output-style=stream
  else
    run "lint" npx nx run-many -t lint --all --parallel="$PARALLEL" --output-style=stream
  fi
fi

if wants guards; then
  # The guard surfaces that live OUTSIDE the nx graph, run CONCURRENTLY by
  # tools/scripts/run-guards.mjs (AGL-2486). They used to run here in a serial
  # `for` loop: ~40 `npm run` invocations, 1m09s, almost all of it process
  # startup. Sampled individually they are 0.4s-5.5s and every one is a pure
  # node script that reads tracked files and writes nothing — the six that even
  # import writeFileSync do it behind a `--write` flag no guard script passes.
  # Measured on this box at load 21: 1m09s serial -> 15.5s at concurrency 6.
  #
  # The DERIVATION moved into that script unchanged, including the part that
  # matters most: deriving zero guards is a hard failure, not an empty phase.
  # One `run` line now, so the phase has one exit code; the per-guard PASS/FAIL
  # and the failing guards' output are in the log.
  #
  # `--affected` does NOT narrow this phase, and that is a decision rather than
  # an omission. Narrowing was the original plan: run the repo-wide sweeps plus
  # the guards the diff could plausibly touch. Once the phase went from 1m09s
  # to ~15s the entire saving available from narrowing was a few seconds, and
  # the cost of getting the mapping wrong is a guard that silently sits out the
  # one commit it exists to catch. So the fast path runs all 54. run-guards.mjs
  # keeps `--only` and `--repo-wide` because `npm run precheck` uses them
  # pre-commit, where the budget really is seconds.
  run "guards" node tools/scripts/run-guards.mjs --concurrency "$GUARD_CONCURRENCY"
fi

if wants test; then
  # Every `test` target is @nx/jest:jest, so --maxWorkers is safe HERE and only
  # here. Capping it matters: six agents once put 39 jest workers on 10 cores,
  # and the SIGTERMs and 300s suites that produced were read as flaky tests.
  if [ "$AFFECTED" = 1 ]; then
    run "test(affected)" npx nx affected -t test --base="$AFFECTED_BASE_SHA" --head="$GATE_SHA" --parallel="$PARALLEL" --maxWorkers="$MAX_WORKERS" --output-style=stream
  else
    run "test" npx nx run-many -t test --all --parallel="$PARALLEL" --maxWorkers="$MAX_WORKERS" --output-style=stream
  fi
fi

if wants build; then
  # PRODUCTION builds, explicitly. A bare `nx run-many -t build` once went green
  # while BOTH Next production builds errored on a misplaced `use client`.
  # Named per project because `docs` has no `production` configuration.
  #
  # `nx affected -t build` is deliberately NOT used even in the fast path. It
  # would run each app's DEFAULT build configuration, and the whole reason
  # these three lines are named individually is that a bare `nx run-many -t
  # build` once went green while both Next PRODUCTION builds errored on a
  # misplaced `use client`. Affected mode therefore filters WHICH of these
  # three named production builds run; it never changes what a build is.
  BUILDS_RUN=0
  _build_wanted() { # _build_wanted <app>
    [ "$AFFECTED" = 0 ] && return 0
    case " $AFFECTED_APPS " in *" $1 "*) return 0 ;; *) return 1 ;; esac
  }
  _build_wanted console && { run "build:console" npx nx run console:build:production; BUILDS_RUN=$((BUILDS_RUN + 1)); }
  _build_wanted tenant  && { run "build:tenant"  npx nx run tenant:build:production;  BUILDS_RUN=$((BUILDS_RUN + 1)); }
  _build_wanted docs    && { run "build:docs"    npx nx run docs:build;               BUILDS_RUN=$((BUILDS_RUN + 1)); }

  # The one line that must never be inferred from an absence. A phase list
  # with no `build:` row in it reads, to a tired operator at 2am, exactly like
  # a phase list whose builds passed. Say the number.
  if [ "$BUILDS_RUN" = 0 ]; then
    log "build: NO app affected — 0 production builds ran. This gate did NOT prove the apps build."
    PHASE_NAMES+=("build:NONE-RAN"); PHASE_CODES+=("0")
  fi
fi

# --- verdict ---------------------------------------------------------------
SHARED_NX_AFTER=$(find "$SOURCE_REPO/.nx/cache" -type f 2>/dev/null | wc -l | tr -d ' ')
log ""
log "shared checkout .nx/cache files: before=$SHARED_NX_BEFORE after=$SHARED_NX_AFTER"
if [ "$SHARED_NX_BEFORE" != "$SHARED_NX_AFTER" ]; then
  log "WARNING: the shared checkout's nx cache changed during this run — isolation leaked (trap 1)"
fi

log ""
log "=== PHASE EXIT CODES ==="
FAILED=0
i=0
while [ $i -lt ${#PHASE_NAMES[@]} ]; do
  printf '%-34s %s\n' "${PHASE_NAMES[$i]}" "${PHASE_CODES[$i]}" | tee -a "$SUMMARY"
  [ "${PHASE_CODES[$i]}" = "0" ] || FAILED=$((FAILED + 1))
  i=$((i + 1))
done
log "=== $FAILED failing phase(s); gated $GATE_SHA ==="

# HOW THE PACKAGES GOT HERE. Never left implicit: cloning the source
# checkout's node_modules is only honest while the gated ref wants the same
# packages, and the one class of change where that is false is the one class
# where the packages ARE the change (trap 6).
log ""
log "provisioning:${PROVISION_NOTE:- (none)}"
case "$PROVISION_NOTE" in
  *install*)
    log "  one or more trees were INSTALLED from the gated ref's lockfile —"
    log "  this run verified a dependency change against the real packages." ;;
esac
case "$PROVISION_NOTE" in
  *refuse*)
    log "  REFUSED: --no-install was passed, and a lockfile at the gated ref"
    log "  differs from this checkout with no cached tree for it. NOTHING in this"
    log "  run proves anything about that dependency change."
    log "  REMEDY: re-run WITHOUT --no-install and the gate will \`npm ci\` that"
    log "  lockfile, cache it, and gate the packages the ref actually asks for." ;;
esac

# WHICH GATE RAN. Never left to be inferred from the presence of an
# `(affected)` suffix on two rows — the two paths make different claims and the
# summary is the only thing most readers see.
if [ "$AFFECTED" = 1 ]; then
  log ""
  log "PATH: FAST (--affected, base $AFFECTED_BASE)"
  log "  PROVED : types (whole workspace), all 54 guards, lint+tests for"
  log "           $(echo "$AFFECTED_PROJECTS" | wc -w | tr -d ' ') affected project(s),"
  log "           production builds for: ${AFFECTED_APPS:-NONE}"
  log "  NOT PROVED : lint and tests for every unaffected project, and the"
  log "           production build of every app not listed above."
  log "  For a release, run the FULL gate: tools/gate.sh"
else
  log ""
  log "PATH: FULL (whole workspace, all production builds)"
fi
log "logs: $LOGS"

if [ "$KEEP" = 0 ] && [ "$FAILED" = 0 ] && [ "$REUSING" = 0 ]; then
  git -C "$SOURCE_REPO" worktree remove --force "$WT" >/dev/null 2>&1
  log "worktree removed (pass --keep to retain it)"
elif [ "$REUSING" = 1 ]; then
  # Removing it would throw away the provisioned module trees that make the
  # NEXT fast run fast, which is the entire reason this root is stable.
  log "worktree retained at $WT (fast-path root, reused by the next --affected run)"
else
  log "worktree retained at $WT"
fi

[ "$FAILED" = 0 ] || exit 1
exit 0
