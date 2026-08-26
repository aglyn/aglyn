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
#
# AGL-2376 — the five specs in the second group. They are NOT node:test files:
# each is a standalone ESM script with top-level await that collects its own
# results, prints them, and `process.exit(failed ? 1 : 0)`. That is why they
# cannot join the `--test` list above and get a loop of their own.
#
# They had NO runner at all. Five files, 31 assertions about who may read a
# billing document, who may list hosts across an org, whether a wildcard
# re-opened `apiKeys` to the world — committed, maintained (one was edited the
# day before they were found), and never once executed by anything. Meanwhile
# `npm run test:rules` printed "157 tests, 157 pass" and that number contained
# none of them. Adding them here costs no extra emulator boot.
#
# ⚠️ They resolve `cloud/firebase-firestore.rules` relative to the REPO ROOT,
# not to cloud/ — hence the `cd` back out. Run from cloud/ they die on ENOENT
# before asserting anything, which is a red that says nothing about the rules.
set -euo pipefail
NODE_BIN="$(command -v node)"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT/cloud"
npx firebase emulators:exec --only firestore,database --project demo-rules-check \
  "'$NODE_BIN' --test rules-tests/firestore-rules.test.mjs rules-tests/database-rules.test.mjs \
   && cd '$REPO_ROOT' \
   && for spec in \
        cloud/rules-tenant.spec.mjs \
        cloud/rules-org-billing.spec.mjs \
        cloud/rules-working-draft.spec.mjs \
        cloud/marketplace-rules.spec.mjs \
        cloud/hosts-list-constraint.spec.mjs \
        cloud/override-merge.spec.mjs; do \
        echo \"--- \$spec\"; '$NODE_BIN' \"\$spec\" || exit 1; \
      done"
