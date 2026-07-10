#!/usr/bin/env bash
#
# Firestore rules test runner (AGL-235): boots the emulator and runs the
# node:test matrix in cloud/rules-tests/. The real node binary path is
# resolved BEFORE emulators:exec because the firebase-tools standalone
# binary shadows `node` inside the exec shell with its own bundled
# runtime (which can't run `node --test`).
set -euo pipefail
NODE_BIN="$(command -v node)"
cd "$(dirname "$0")/../../cloud"
npx firebase emulators:exec --only firestore --project demo-rules-check \
  "'$NODE_BIN' --test rules-tests/firestore-rules.test.mjs"
