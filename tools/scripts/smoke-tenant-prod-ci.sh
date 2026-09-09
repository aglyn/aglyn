#!/usr/bin/env bash
#
# The tenant production smoke, with its own emulators and its own environment
# (AGL-2709).
#
# `tools/e2e/tenant-prod-smoke.mjs` has existed since the AGL-594 outage and
# says in its own docblock that it is "the pre-deploy gate for request-time-only
# failures that dev servers and successful builds both miss". It was referenced
# by no workflow and by no phase of `tools/gate.sh`, so it gated nothing. On
# 2026-09-09 the failure it was written for happened again — every tenant page
# 500ing with `DYNAMIC_SERVER_USAGE` — and shipped under 28 green PR checks.
#
# This is the piece that was missing: everything the smoke assumes a developer
# has already done, done by a runner instead.
#
#   1. the emulator stack (auth + firestore on cloud/firebase.e2e.json)
#   2. the seed those fixtures come from
#   3. an environment firebase-admin will initialize under
#
# ---------------------------------------------------------------------------
# NO PRODUCTION CREDENTIAL, DELIBERATELY
# ---------------------------------------------------------------------------
# `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` are already repo secrets,
# and using them here would be the obvious thing and the wrong one.
#
#  - `libs/shared/util/fbserver` skips `initializeApp` entirely unless the
#    private key, the client email and the project id are ALL present, so
#    SOMETHING has to be set or every route 500s with "the default Firebase app
#    does not exist" and the smoke reports an outage that is really a missing
#    env file. That failure reads exactly like the one this gate exists to
#    catch, which is the worst possible confusion for a gate to introduce.
#  - Nothing ever signs with the key. `FIRESTORE_EMULATOR_HOST` puts the Admin
#    SDK on gRPC against localhost, where it sends `Authorization: Bearer
#    owner` and the emulator waves it through; the credential is required at
#    construction and unused at every call. (`tenant-prod-smoke.mjs` sets
#    `AGLYN_DISABLE_BOOT_WARMUP=1` for the other half of this — over REST the
#    google-auth-library stamps a REAL token over that header and the emulator
#    rules-evaluates every read to a denial. See AGL-1504 there.)
#
# So the key is generated here, per run, and is a credential to nothing. The
# gate therefore needs no secret, cannot reach production data, and runs
# identically on a fork. A gate that reds when a secret is unset is a gate
# someone eventually switches off.
#
# ---------------------------------------------------------------------------
# WHY THE EMULATORS ARE BOOTED BY HAND AND NOT BY `emulators:exec`
# ---------------------------------------------------------------------------
# Because `emulators:exec` breaks nx, and the first version of this file found
# that out the expensive way. `test-emulator-guards.sh` records the same shape
# for jest — "Preset ../../../jest.preset.js not found", surviving an absolute
# path to the real node binary — and nx fails one step earlier still:
#
#   TypeError: WorkspaceContext is not a constructor
#     at setupWorkspaceContext (node_modules/nx/dist/src/utils/workspace-context.js)
#
# Measured inside an exec shell with `npx nx show projects`, which works
# perfectly outside one. It is not the `PKG_EXECPATH` the firebase binary
# exports — unsetting that changes nothing — and it is not the shadowed `node`,
# which is separately real and is why `NODE_BIN` is still resolved below.
# Something in the environment `emulators:exec` hands its child defeats nx's
# native-module loader specifically.
#
# There is no way around it here: the smoke's whole point is a REAL, uncached
# `nx build tenant --configuration=production`, and `SMOKE_SKIP_BUILD=1` is
# disqualified by the smoke's own header — it asserts against an existing dist
# INCLUDING ITS ISR CACHE, which weakens the scope assertions into no-ops.
#
# So this boots the stack itself, exactly as `test-emulator-guards.sh` does,
# and every trap below is inherited from that file rather than rediscovered.
#
# ⚠️ NOTHING IS PIPED. A pipe swallows the exit code, which is the trap
# `emulator-guards.yml` opens with.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# The real node binary. The firebase-tools standalone binary shadows `node`
# inside its own child shells with a bundled runtime; resolving this before
# anything firebase-flavored runs is the same precaution `test-rules.sh` takes.
NODE_BIN="$(command -v node)"

# `aglyn-main`, not a `demo-` id, for the reason `test-emulator-guards.sh`
# records: the seed and the fixtures resolve the project from the emulator's
# own default, and a mismatched id turns every fixture read into a not-found
# that reads as a broken page. `cloud/firebase.e2e.json` pins these ports.
PROJECT_ID=aglyn-main
FIRESTORE_PORT=8082
AUTH_PORT=9099

# A throwaway RSA key, valid PEM, credential to nothing. See the header.
FIREBASE_PRIVATE_KEY="$(openssl genrsa 2048 2>/dev/null)"
export FIREBASE_PRIVATE_KEY
export FIREBASE_CLIENT_EMAIL='tenant-prod-smoke@aglyn-main.iam.gserviceaccount.com'

export NEXT_PUBLIC_FIREBASE_PROJECT_ID="$PROJECT_ID"
export FIREBASE_PROJECT_ID="$PROJECT_ID"
export NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN='aglyn-main.firebaseapp.com'
export NEXT_PUBLIC_FIREBASE_DATABASE_URL='https://aglyn-main-default-rtdb.firebaseio.com'
export NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET='aglyn-main.appspot.com'

# The hostname split the tenant middleware routes on. Not secrets, and not
# guesses: these are the values `apps/tenant/.env` carries, and the smoke's
# fixtures are seeded against them.
export AGLYN_CONSOLE_HOSTNAME='console.aglyn.io'
export AGLYN_APP_HOSTNAME='aglyn.app'
export AGLYN_TENANT_DEMO='demo'

export NEXT_TELEMETRY_DISABLED='1'

# Full template, not `mktemp -t <prefix>`. BSD mktemp treats a bare `-t`
# argument as a prefix; GNU mktemp demands three X's. This script is written on
# macOS and runs on ubuntu-latest, so the BSD-only spelling passes locally and
# fails on the first CI run — which is exactly how its sibling learned this.
EMULATOR_LOG="$(mktemp "${TMPDIR:-/tmp}/tenant-prod-smoke.XXXXXX")"
EMULATOR_PID=""

# Kill the process GROUP, not the pid. `npx firebase emulators:start` is four
# processes deep — npm exec, the firebase shim, the real entry point, and one
# `java -jar` per emulator — and signaling only the top leaves both JVMs
# holding their ports. `set -m` puts the background job in its own group so
# `$!` is a pgid and `kill -- -PGID` reaches them.
cleanup() {
  if [[ -n "$EMULATOR_PID" ]]; then
    kill -- -"$EMULATOR_PID" 2>/dev/null || true
    wait "$EMULATOR_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "==> starting emulators (auth, firestore) for $PROJECT_ID"
set -m
(
  cd "$REPO_ROOT/cloud"
  npx firebase emulators:start \
    --config firebase.e2e.json \
    --only auth,firestore \
    --project "$PROJECT_ID" \
    >"$EMULATOR_LOG" 2>&1
) &
EMULATOR_PID=$!
set +m

echo "==> waiting for emulators"
ready=0
for _ in $(seq 1 60); do
  # No `-f`. This asks "is something listening and speaking HTTP", and the
  # emulators answer their bare root with a 404, which `-f` would turn into a
  # failure — the probe then times out against two healthy emulators.
  if curl -s -o /dev/null "http://127.0.0.1:${FIRESTORE_PORT}/" &&
    curl -s -o /dev/null "http://127.0.0.1:${AUTH_PORT}/"; then
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

export FIRESTORE_EMULATOR_HOST="localhost:${FIRESTORE_PORT}"
export FIREBASE_AUTH_EMULATOR_HOST="localhost:${AUTH_PORT}"

cd "$REPO_ROOT"
echo "==> seeding"
"$NODE_BIN" tools/scripts/seed-e2e.mjs

echo "==> smoke"
"$NODE_BIN" tools/e2e/tenant-prod-smoke.mjs
