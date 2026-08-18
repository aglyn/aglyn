#!/usr/bin/env bash
#
# Emulator-guard runner (AGL-2002): boots the emulators and runs every
# `*.emulator.spec.ts` in the workspace against them.
#
# WHY THIS EXISTS
#
# Eighteen specs carry this gate:
#
#   const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
#   const describeEmulated = EMULATED ? describe : describe.skip
#
# Nothing in .github/workflows/ ever set FIRESTORE_EMULATOR_HOST for jest, so
# in CI all eighteen reported as passing-with-skips — the worst reporting
# outcome available, because a skip renders green. Three of them are the
# GDPR-erasure guards behind DPA §11 and the published Privacy Policy.
#
# WHY `emulators:exec` IS NOT USED HERE, unlike test-rules.sh
#
# `firebase emulators:exec "<jest …>"` fails before running a single test:
#
#   Preset ../../../jest.preset.js not found relative to rootDir …
#
# It is NOT the shadowed `node` that test-rules.sh works around — the failure
# survives an absolute path to the real node binary AND an absolute path to
# jest's own entrypoint, and inside that same exec shell a plain
# `require('<root>/jest.preset.js')` loads the preset fine (12 keys). Something
# in the environment `emulators:exec` hands its child defeats jest's own
# resolver specifically. Not chased further; starting the emulators ourselves
# is verified working and costs a trap.
#
# The tradeoff is teardown, which the trap below covers on every exit path.
#
# EXIT CODE: non-zero if any suite fails, if the emulators never come up, or
# if the run did not actually execute the specs — see the tail of this file.
# Nothing is piped, so no exit code is swallowed (the mistake this whole issue
# is about; `emulators:exec … | tail` reports success on a jest failure).
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$PWD"

# `aglyn-main`, not a `demo-` id, and it is load-bearing. Every one of the
# eighteen specs calls `initializeApp({ projectId: 'aglyn-main' })`, and the
# console specs mint a token through the Auth emulator's REST endpoint, which
# resolves the project from the emulator's own default. Under a `demo-*`
# project the Admin SDK writes the user under `aglyn-main` and the REST
# sign-in looks for it under the demo project: EMAIL_NOT_FOUND, four red
# tests, nothing to do with the code under test.
#
# No credentials are reachable: FIRESTORE_EMULATOR_HOST and
# FIREBASE_AUTH_EMULATOR_HOST below keep both SDKs on localhost, and CI has no
# service-account key to fall back to.
PROJECT_ID=aglyn-main
FIRESTORE_PORT=8082
AUTH_PORT=9099
DATABASE_PORT=9000

EMULATOR_LOG="$(mktemp -t emulator-guards)"
EMULATOR_PID=""

# Kill the process GROUP, not the pid. `npx firebase emulators:start` is four
# processes deep — npm exec, the firebase shim, the real firebase-tools entry,
# and one `java -jar` per emulator — and signalling only the top of that chain
# leaves npm reparented to init with both JVMs still holding 8082 and 9000.
# Verified by leaving orphans behind exactly that way: the next run then finds
# the ports taken and fails for a reason that has nothing to do with the code.
#
# `set -m` puts the background job in its own process group, so `$!` is a pgid
# and `kill -- -PGID` reaches the JVMs. Ephemeral CI runners would not care;
# a developer running this twice would.
cleanup() {
  if [[ -n "$EMULATOR_PID" ]]; then
    kill -- -"$EMULATOR_PID" 2>/dev/null || true
    wait "$EMULATOR_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "==> starting emulators (firestore, auth, database) for $PROJECT_ID"
set -m
(
  cd "$ROOT/cloud"
  npx firebase emulators:start \
    --only firestore,auth,database \
    --project "$PROJECT_ID" \
    >"$EMULATOR_LOG" 2>&1
) &
EMULATOR_PID=$!
set +m

echo "==> waiting for emulators"
ready=0
for _ in $(seq 1 60); do
  # No `-f`. This asks "is something listening and speaking HTTP", and the
  # emulators answer their bare root with a 404, which `-f` turns into a
  # failure — the probe then times out against three healthy emulators.
  if curl -s -o /dev/null "http://127.0.0.1:${FIRESTORE_PORT}/" &&
    curl -s -o /dev/null "http://127.0.0.1:${AUTH_PORT}/" &&
    curl -s -o /dev/null "http://127.0.0.1:${DATABASE_PORT}/"; then
    ready=1
    break
  fi
  sleep 2
done
if [[ "$ready" -ne 1 ]]; then
  echo "!! emulators did not come up within 120s" >&2
  cat "$EMULATOR_LOG" >&2
  exit 1
fi
echo "==> emulators ready"

export FIRESTORE_EMULATOR_HOST="127.0.0.1:${FIRESTORE_PORT}"
export FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:${AUTH_PORT}"
export FIREBASE_DATABASE_EMULATOR_HOST="127.0.0.1:${DATABASE_PORT}"

# One jest invocation per nx project (single-project runs only). The three
# listed here are every project that currently owns a `*.emulator.spec.ts`;
# the coverage assertion at the end is what notices when a fourth appears.
PROJECTS=(
  apps/console
  libs/tenant/data/admin
  libs/tenant/runtime
)

REPORT_DIR="$(mktemp -d -t emulator-guard-reports)"
status=0
for project in "${PROJECTS[@]}"; do
  echo "==> $project"
  slug="${project//\//-}"
  # `--testPathPatterns`, PLURAL. jest 30 renamed it, and the singular
  # `--testPathPattern` is accepted-and-IGNORED rather than rejected: the run
  # then quietly executes the project's ENTIRE suite while reading as a
  # narrow one. Confirm the suite counts below look narrow if you change this.
  if ! npx jest \
    --config "$project/jest.config.ts" \
    --testPathPatterns '\.emulator\.spec\.ts$' \
    --ci \
    --json --outputFile "$REPORT_DIR/$slug.json"; then
    status=1
  fi
done

# The run has to have actually RUN. Without this the script's own green means
# only "jest exited 0", which is exactly what it meant when every spec was
# skipping: zero failures, zero coverage. Two separate ways that happens —
#
#   - the emulator gate skipped the suites (numPendingTests > 0), the
#     AGL-2002 defect itself; or
#   - the path filter matched nothing (numTotalTests == 0), a green that
#     proves only that the filter is wrong.
#
# Both are asserted, and the expected-file floor catches a spec silently
# dropping out of the sweep.
node tools/scripts/lib/assert-emulator-coverage.mjs "$REPORT_DIR" || status=1

exit "$status"
