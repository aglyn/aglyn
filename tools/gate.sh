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
PARALLEL="${GATE_PARALLEL:-3}"
MAX_WORKERS="${GATE_MAX_WORKERS:-2}"
PHASES="typecheck,lint,guards,test,build"

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
    -h|--help)      sed -n '2,80p' "$0"; exit 0 ;;
    *) echo "gate: unknown argument '$1'" >&2; exit 64 ;;
  esac
done

SOURCE_REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

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
  offenders=$(grep -nE 'run "(lint|build:[a-z]+)"' "$0" | grep -c 'maxWorkers')
  if [ "$offenders" = "0" ]; then
    echo "ok   no --maxWorkers on a shell-command phase"; pass=$((pass + 1))
  else
    echo "FAIL --maxWorkers reached a shell-command phase ($offenders)"; fail=$((fail + 1))
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
[ -n "$GATE_ROOT" ] || GATE_ROOT="/private/tmp/aglyn-gate/$(date +%Y%m%d-%H%M%S)"
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
fi
log "worktree at : $WT ($(git -C "$WT" rev-parse HEAD))"

run "provision:root"      clone_modules node_modules
run "provision:docs"      clone_modules apps/docs/node_modules
run "provision:functions" clone_modules cloud/functions/node_modules
run "provision:verify"    verify_modules

# --- isolated environment --------------------------------------------------
# TRAP 1. NX_CACHE_DIRECTORY is the one that a worktree does NOT give you.
export NX_CACHE_DIRECTORY="$GATE_ROOT/nx-cache"
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
  run "lint" npx nx run-many -t lint --all --parallel="$PARALLEL" --output-style=stream
fi

if wants guards; then
  # The guard surfaces that live OUTSIDE the nx graph. The list is DERIVED from
  # the CI workflows rather than hand-maintained here, so a guard added to CI is
  # gated automatically and this file cannot silently fall behind.
  # (`mapfile` is bash 4; this box ships bash 3.2, hence the read loop.)
  GUARDS=()
  while IFS= read -r g; do
    [ -n "$g" ] && GUARDS+=("$g")
  done < <(
    grep -hoE '^[[:space:]]+- run: npm run [a-z0-9:_-]+' \
      "$WT/.github/workflows/nx-ci.yml" "$WT/.github/workflows/tools-guards.yml" \
      | sed 's/.*npm run //' | sort -u | grep -vx 'typecheck'
  )
  log "guards derived from CI: ${#GUARDS[@]}"
  if [ ${#GUARDS[@]} -eq 0 ]; then
    log "FAIL: derived zero guards — the workflow files moved; fix the query, do not drop the phase"
    PHASE_NAMES+=("guards:derive"); PHASE_CODES+=("1")
  else
    for g in "${GUARDS[@]}"; do run "guard:$g" npm run "$g"; done
  fi
fi

if wants test; then
  # Every `test` target is @nx/jest:jest, so --maxWorkers is safe HERE and only
  # here. Capping it matters: six agents once put 39 jest workers on 10 cores,
  # and the SIGTERMs and 300s suites that produced were read as flaky tests.
  run "test" npx nx run-many -t test --all --parallel="$PARALLEL" --maxWorkers="$MAX_WORKERS" --output-style=stream
fi

if wants build; then
  # PRODUCTION builds, explicitly. A bare `nx run-many -t build` once went green
  # while BOTH Next production builds errored on a misplaced `use client`.
  # Named per project because `docs` has no `production` configuration.
  run "build:console" npx nx run console:build:production
  run "build:tenant"  npx nx run tenant:build:production
  run "build:docs"    npx nx run docs:build
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
log "logs: $LOGS"

if [ "$KEEP" = 0 ] && [ "$FAILED" = 0 ]; then
  git -C "$SOURCE_REPO" worktree remove --force "$WT" >/dev/null 2>&1
  log "worktree removed (pass --keep to retain it)"
else
  log "worktree retained at $WT"
fi

[ "$FAILED" = 0 ] || exit 1
exit 0
