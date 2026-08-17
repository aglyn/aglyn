/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Fails when the LIVE Firestore index configuration drifts from
// `cloud/firebase-firestore.indexes.json` (AGL-1804). The index counterpart of
// check-rules-drift.mjs, and it exists for the same reason: indexes deploy
// MANUALLY (`firebase deploy --only firestore:indexes`), outside the git
// pipeline, so a merged commit touching the index file is NOT evidence the
// index shipped.
//
//   npm run check:index-drift
//   npm run check:index-drift -- --file=/tmp/doctored.indexes.json
//
// Nothing here writes or deploys. Two GETs against the Firestore Admin API.
//
// ONE DAY'S MANUAL DIFF FOUND THREE BUGS THIS WOULD HAVE CAUGHT ON THE DAY
// EACH LANDED, and they are the two directions the report separates:
//
//   PROD-ONLY  the project has it, the file does not → THE NEXT DEPLOY DELETES
//              IT. AGL-1801: a live `mediaTombstones.expiresAt` TTL policy an
//              unrelated index deploy was armed to disable, which is AGL-866
//              (`versions.nodes`, actually deleted) recurring. This is the
//              dangerous direction and the reason a bare "does the file match"
//              check is not enough: the file being wrong is not what hurts —
//              deploying it is.
//   FILE-ONLY  the file has it, the project does not → the index is NOT
//              DEPLOYED and every query needing it throws FAILED_PRECONDITION.
//              AGL-1793/AGL-1802: three cron collection-group scans that had
//              never once run against real data, each swallowing the failure
//              into a 500 nobody reads.
//
// A composite index is NOT a prefix substitute (AGL-1802): `bookings` carried
// a COLLECTION_GROUP `status + expiresAtMs` composite and still could not
// serve a `startsAtMs`-only query. This check compares the SETS of indexes, so
// a green run means the project matches the file — it does NOT mean every
// query in the repo is served. That is the per-query job of the
// `*-indexes.spec.ts` guards, and of AGL-1814.
//
// Auth: the rules checker's exact path, service account from the root .env
// (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY;
// self-loaded, already-set env wins). INDEX_CHECK_ACCESS_TOKEN skips minting
// (e.g. `INDEX_CHECK_ACCESS_TOKEN=$(gcloud auth print-access-token)`).
// The env files are read RELATIVE TO THE CWD, so run from a checkout root.
//
// Exit codes — cannot-check must NEVER masquerade as clean:
//   0  the project matches the file
//   1  drift, in either direction (each bucket printed and named)
//   2  the comparison could not be made (missing creds, auth, network, or an
//      unreadable/malformed index file). Drift wins when both occur.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadLocalEnv } from './lib/firebase-rules-api.mjs'
import {
  fetchLiveCompositeIndexes,
  fetchLiveFieldOverrides,
  resolveDatabaseId,
  resolveReadToken,
} from './lib/firestore-indexes-api.mjs'
import { compareIndexes, describeOverride } from './lib/index-drift.mjs'

loadLocalEnv()

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const DEFAULT_FILE = `${repoRoot}cloud/firebase-firestore.indexes.json`

// --file=<path> points the check at a different index file. It exists so the
// checker can be FAULT-INJECTED against real production without editing the
// shared checkout's file: copy it, doctor the copy, run against the copy.
// A guard nobody has watched fail is not known to work.
let filePath = DEFAULT_FILE
for (const arg of process.argv.slice(2).filter((a) => a !== '--')) {
  if (arg.startsWith('--file=')) {
    filePath = arg.slice('--file='.length)
    continue
  }
  console.error(
    `Unknown argument '${arg}'. Usage: check-index-drift [--file=<path>]`,
  )
  process.exit(2)
}

let indexFile
try {
  indexFile = JSON.parse(readFileSync(filePath, 'utf8'))
} catch (error) {
  console.error(
    [
      `Cannot check: ${filePath} could not be read as JSON.`,
      `  ${error.message}`,
      '',
      'Exiting 2 (cannot-check). Cannot-check is NOT clean.',
    ].join('\n'),
  )
  process.exit(2)
}
if (
  !Array.isArray(indexFile.indexes) ||
  !Array.isArray(indexFile.fieldOverrides)
) {
  console.error(
    `Cannot check: ${filePath} has no \`indexes\`/\`fieldOverrides\` arrays. Exiting 2.`,
  )
  process.exit(2)
}

const auth = await resolveReadToken()
if (auth.error) {
  console.error(
    [
      `Cannot check: ${auth.error}`,
      '',
      'This check compares the LIVE Firestore index config against the repo',
      'file; without credentials it cannot see live, and reporting success',
      'here would be the silent-drift failure mode it exists to prevent',
      '(AGL-1801 — a live TTL policy the next deploy was armed to delete).',
      '',
      'Locally: the repo .env supplies FIREBASE_PROJECT_ID,',
      'FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY (self-loaded); run from',
      'a checkout root, since those files are resolved against the CWD.',
      'In CI: the same repo secrets rules-drift.yml already uses.',
      'Alternatively set INDEX_CHECK_ACCESS_TOKEN with FIREBASE_PROJECT_ID.',
      '',
      'Exiting 2 (cannot-check). Cannot-check is NOT clean.',
    ].join('\n'),
  )
  process.exit(2)
}

const databaseId = resolveDatabaseId()
let liveIndexes
let liveFields
try {
  liveIndexes = await fetchLiveCompositeIndexes({ ...auth, databaseId })
  liveFields = await fetchLiveFieldOverrides({ ...auth, databaseId })
} catch (error) {
  console.error(
    `Cannot check: reading the live index config failed: ${error.message}`,
  )
  console.error('Exiting 2 (cannot-check). Cannot-check is NOT clean.')
  process.exit(2)
}

const report = compareIndexes({
  liveIndexes,
  liveFields,
  fileIndexes: indexFile.indexes,
  fileOverrides: indexFile.fieldOverrides,
})

const where = `project ${auth.projectId}, database ${databaseId}`
const fileLabel =
  filePath === DEFAULT_FILE ? 'cloud/firebase-firestore.indexes.json' : filePath
console.log(`Live: ${where}`)
console.log(`File: ${fileLabel}`)
console.log(
  `Composite indexes: ${report.composite.matched} matched ` +
    `(live ${liveIndexes.length}, file ${indexFile.indexes.length}) — the trailing ` +
    `\`__name__\` Firestore appends to every deployed composite is discounted.`,
)
console.log(
  `Field overrides:   ${report.overrides.matched} matched ` +
    `(live ${liveFields.length - report.skipped.length}, file ${indexFile.fieldOverrides.length}).`,
)
for (const line of report.skipped)
  console.log(`  not comparable, skipped: ${line}`)

// Index builds are ASYNC: "deployed" is not "ready", and a query against a
// CREATING index still fails. Reported whether or not anything drifted.
if (report.notReady.length > 0) {
  console.log(
    `\nNOT READY — deployed but still building (${report.notReady.length}):`,
  )
  for (const line of report.notReady) console.log(`  ${line}`)
}

if (report.composite.prodOnly.length > 0) {
  console.error(
    `\nPROD-ONLY composite indexes (${report.composite.prodOnly.length}) — THE NEXT \`firebase deploy --only firestore:indexes\` DELETES THESE:`,
  )
  for (const key of report.composite.prodOnly) console.error(`  ${key}`)
}
if (report.overrides.prodOnly.length > 0) {
  console.error(
    `\nPROD-ONLY field overrides (${report.overrides.prodOnly.length}) — THE NEXT INDEX DEPLOY DELETES THESE (the AGL-1801/AGL-866 shape):`,
  )
  for (const entry of report.overrides.prodOnly) {
    console.error(`  ${describeOverride(entry)}`)
    if (entry.ttl) {
      console.error(
        `    ⚠️ this is a LIVE TTL policy (${entry.ttlState}); losing it stops the sweep and the documents accumulate.`,
      )
    }
  }
}
if (report.composite.fileOnly.length > 0) {
  console.error(
    `\nFILE-ONLY composite indexes (${report.composite.fileOnly.length}) — NOT DEPLOYED; queries needing them throw FAILED_PRECONDITION:`,
  )
  for (const key of report.composite.fileOnly) console.error(`  ${key}`)
}
if (report.overrides.fileOnly.length > 0) {
  console.error(
    `\nFILE-ONLY field overrides (${report.overrides.fileOnly.length}) — NOT DEPLOYED; queries needing them throw FAILED_PRECONDITION (the AGL-1793/AGL-1802 shape):`,
  )
  for (const entry of report.overrides.fileOnly) {
    console.error(`  ${describeOverride(entry)}`)
  }
}
if (report.overrides.differing.length > 0) {
  console.error(
    `\nDIFFERING field overrides (${report.overrides.differing.length}) — present on both sides, configured differently:`,
  )
  for (const entry of report.overrides.differing) {
    console.error(`  ${entry.id}`)
    for (const reason of entry.reasons) console.error(`    ${reason}`)
  }
}

if (report.drift) {
  console.error(
    [
      '',
      'Index drift detected. The two directions need OPPOSITE responses —',
      'read which bucket a line is in before acting:',
      '  PROD-ONLY → do NOT deploy yet. Copy the live entry into the file',
      '    first (`firebase firestore:indexes --project <p>` prints it in the',
      "    file's own shape), or the deploy destroys it.",
      '  FILE-ONLY → the deploy is owed: `firebase deploy --only',
      '    firestore:indexes`. Then re-run this — builds are async, and',
      '    "deployed" is not "ready".',
    ].join('\n'),
  )
  process.exit(1)
}
console.log(`\nNo drift: ${where} matches ${fileLabel}.`)
