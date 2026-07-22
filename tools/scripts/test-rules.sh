#!/usr/bin/env bash
#
# Security-rules test runner (AGL-235, AGL-675): boots the emulators and
# runs the node:test matrix in cloud/rules-tests/.
#
# Covers Firestore AND the Realtime Database. RTDB was added when presence
# became the first feature to open it (AGL-675) — until then it was
# deny-all and, more to the point, untested, while every Firestore rule
# here has a negative control.
#
# The real node binary path is resolved BEFORE emulators:exec because the
# firebase-tools standalone binary shadows `node` inside the exec shell
# with its own bundled runtime (which can't run `node --test`).
set -euo pipefail
NODE_BIN="$(command -v node)"
cd "$(dirname "$0")/../../cloud"
npx firebase emulators:exec --only firestore,database --project demo-rules-check \
  "'$NODE_BIN' --test rules-tests/firestore-rules.test.mjs rules-tests/database-rules.test.mjs"
