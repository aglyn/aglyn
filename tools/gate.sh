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
#       '/Users/zgover/Documents/VCS/aglyn/.nx/cache/terminalOutputs/5760910…'
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
    --base)         AFFECTED_BASE="$2"; shift 2 ;;
    -h|--help)      sed -n '2,80p' "$0"; exit 0 ;;
    *) echo "gate: unknown argument '$1'" >&2; exit 64 ;;
  esac
done

SOURCE_REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

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

  if [ "$load10" -le $((cores10 * 3 / 10)) ]; then
    band="idle"; p=6; w=4
  elif [ "$load10" -le $((cores10 * 7 / 10)) ]; then
    band="light"; p=4; w=3
  elif [ "$load10" -le "$cores10" ]; then
    band="busy"; p=3; w=2
  else
    band="loaded"; p=2; w=2
  fi

  # Never more nx tasks than cores, whatever the band says.
  [ "$p" -gt "$cores" ] && p=$cores

  local from_p="$PARALLEL" from_w="$MAX_WORKERS"
  [ "$PARALLEL" = "auto" ] && PARALLEL="$p"
  [ "$MAX_WORKERS" = "auto" ] && MAX_WORKERS="$w"
  PARALLELISM_NOTE="cores=$cores load1m=$load band=$band -> --parallel=$PARALLEL --maxWorkers=$MAX_WORKERS"
  [ "$from_p" = "auto" ] || PARALLELISM_NOTE="$PARALLELISM_NOTE (parallel PINNED to $from_p)"
  [ "$from_w" = "auto" ] || PARALLELISM_NOTE="$PARALLELISM_NOTE (maxWorkers PINNED to $from_w)"
}

clone_modules() { # clone_modules <relative path>
  local rel="$1"
  local src="$SOURCE_REPO/$rel"
  local dest="$WT/$rel"
  [ -d "$src" ] || { echo "gate: $src missing — run npm ci there first" >&2; return 1; }
  # TRAP 3(a): the destination MUST NOT exist, or the copy nests inside it.
  rm -rf "$dest"
  mkdir -p "$(dirname "$dest")"
  # TRAP 2 / 3(b): a real directory (never a symlink), copy-on-write (never
  # hard links, which would let the gate write back into the shared checkout).
  cp -Rc "$src" "$dest" 2>/dev/null || cp -R "$src" "$dest"
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
LOCK_STAMP="$GATE_ROOT/.provisioned-lock"
LOCK_NOW=$(git -C "$WT" rev-parse HEAD:package-lock.json 2>/dev/null || echo unknown)
if [ "$REUSED_WT" = 1 ] && [ -f "$LOCK_STAMP" ] && [ "$(cat "$LOCK_STAMP")" = "$LOCK_NOW" ] \
   && [ -d "$WT/node_modules" ] && [ -d "$WT/apps/docs/node_modules" ] \
   && [ -d "$WT/cloud/functions/node_modules" ]; then
  log "provision   : REUSED (package-lock.json unchanged at $LOCK_NOW)"
else
  [ "$REUSED_WT" = 1 ] && log "provision   : re-cloning (lock $LOCK_NOW, stamp $(cat "$LOCK_STAMP" 2>/dev/null || echo none))"
  run "provision:root"      clone_modules node_modules
  run "provision:docs"      clone_modules apps/docs/node_modules
  run "provision:functions" clone_modules cloud/functions/node_modules
  printf '%s\n' "$LOCK_NOW" > "$LOCK_STAMP"
fi

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
# other. `--fresh-cache` still empties it for a run that needs to distrust it.
NX_CACHE_HOME="${GATE_NX_CACHE:-/private/tmp/aglyn-gate/nx-cache}"
export NX_CACHE_DIRECTORY="$NX_CACHE_HOME"
export NX_DAEMON=false
export NPM_CONFIG_CACHE="$GATE_ROOT/npm-cache"
export NODE_OPTIONS="--max-old-space-size=8192"
export CI=true
[ "$FRESH_CACHE" = 1 ] && rm -rf "$NX_CACHE_DIRECTORY"
mkdir -p "$NX_CACHE_DIRECTORY" "$NPM_CONFIG_CACHE"
log "nx cache    : $NX_CACHE_DIRECTORY"
cd "$WT" || exit 67

# Prove the isolation instead of trusting it: nothing this run does may appear
# in the shared checkout's .nx. Recorded before and after as a bare comparison.
SHARED_NX_BEFORE=$(find "$SOURCE_REPO/.nx/cache" -type f 2>/dev/null | wc -l | tr -d ' ')

# --- parallelism -----------------------------------------------------------
choose_parallelism
log "parallelism : $PARALLELISM_NOTE"
# The guards are node scripts rather than nx tasks, so they get their own
# budget: lighter than a jest worker, bounded by cores. run-guards.mjs would
# read the load itself, but then each phase would adapt to a DIFFERENT reading
# taken at a different moment; one reading for the whole gate is the point.
GUARD_CONCURRENCY=$((PARALLEL * 2))
[ "$GUARD_CONCURRENCY" -gt 8 ] && GUARD_CONCURRENCY=8
# The typecheck driver runs its own pool of `tsc` processes; same reasoning.
export TYPECHECK_CONCURRENCY=$((PARALLEL * 2))
[ "$TYPECHECK_CONCURRENCY" -gt 8 ] && TYPECHECK_CONCURRENCY=8

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
  AFFECTED_PROJECTS=$(npx nx show projects --affected --base="$AFFECTED_BASE_SHA" --head="$GATE_SHA" 2>/dev/null | tr '\n' ' ')
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
