#!/usr/bin/env node
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

// Find — and only on demand, scrub — documents carrying a PERSISTED synthetic
// `$id` (AGL-1889).
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/find-persisted-synthetic-id.mjs
//
//   …  --scrub hosts/4uYCmrbU5t/products/3kSqI_EGFP     # one named document
//
// READ-ONLY unless `--scrub` names document paths. There is deliberately no
// "scrub everything you found" flag; see `scrubPlan` in
// `lib/persisted-synthetic-id.mjs` for why.
//
// ## What it does NOT touch
//
// The scrub is `FieldValue.delete()` on a RAW `DocumentReference`, through
// `update()`, naming exactly one field.
//
//  * `update()`, not `set(…, { merge: true })` — a merge-set cannot express a
//    field deletion as the only change, and a converter attached anywhere on
//    the path would run over a PARTIAL payload and re-default fields that are
//    absent from it. That is AGL-1374's own hazard class turned around: a
//    repair writing back through a converter destroys more than the bug did.
//  * no `withConverter`, ever. The reference comes from `db.doc(path)`.
//  * `new FieldPath('$id')` rather than the string `'$id'`. Firestore parses a
//    string key in `update()` as a field PATH, and an unquoted segment must
//    match `[A-Za-z_][A-Za-z_0-9]*`. `$id` does not, so the string form is a
//    parse error rather than a deletion of the field actually named.
//  * `updateTime` precondition — the document must not have changed since the
//    read that justified the scrub.
//
// ## The positive control
//
// A sweep that reports zero hits proves nothing on its own; besigner screens
// store a `$id` per canvas node, so a live sweep necessarily finds hundreds
// nested. Finding none means the walk is broken, and this script REFUSES to
// print a verdict in that case rather than printing a reassuring one.

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldPath, FieldValue, getFirestore } from 'firebase-admin/firestore'

import {
  assertPositiveControl,
  countNestedSyntheticIds,
  hasPersistedSyntheticId,
  scrubPlan,
} from './lib/persisted-synthetic-id.mjs'

/** Root collections whose documents are authored through listener-backed UI. */
const ROOTS = ['hosts', 'orgs']

const argv = process.argv.slice(2)
const scrubIndex = argv.indexOf('--scrub')
const scrubTargets = scrubIndex === -1 ? [] : argv.slice(scrubIndex + 1)

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!projectId || !clientEmail || !privateKey) {
  console.error(
    'Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY',
  )
  process.exit(1)
}
if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}
const db = getFirestore(process.env.FIRESTORE_DATABASE_ID)

console.log(
  `Persisted \`$id\` sweep — project ${projectId}` +
    (process.env.FIRESTORE_EMULATOR_HOST
      ? ` — EMULATOR ${process.env.FIRESTORE_EMULATOR_HOST}`
      : ' — LIVE'),
)

const hits = []
let documentsScanned = 0
let nestedKeys = 0

/** Record one document against both the defect and the control. */
function inspect(path, id, data, updateTime) {
  documentsScanned += 1
  nestedKeys += countNestedSyntheticIds(data)
  if (!hasPersistedSyntheticId(data)) return
  hits.push({
    path,
    value: data['$id'],
    matchesOwnId: data['$id'] === id,
    updateTime: updateTime?.toDate?.().toISOString() ?? null,
  })
}

for (const root of ROOTS) {
  for (const scopeRef of await db.collection(root).listDocuments()) {
    const scopeSnap = await scopeRef.get()
    if (scopeSnap.exists) {
      inspect(
        `${root}/${scopeRef.id}`,
        scopeRef.id,
        scopeSnap.data(),
        scopeSnap.updateTime,
      )
    }
    for (const collection of await scopeRef.listCollections()) {
      const snap = await collection.get()
      for (const doc of snap.docs) {
        inspect(
          `${root}/${scopeRef.id}/${collection.id}/${doc.id}`,
          doc.id,
          doc.data(),
          doc.updateTime,
        )
      }
    }
  }
}

// Before any verdict. A dead control is a broken sweep, not a clean database.
assertPositiveControl({ nestedKeys, documentsScanned })

console.log(`\ndocuments scanned          ${documentsScanned}`)
console.log(`positive control (nested)  ${nestedKeys} \`$id\` keys — sweep is live`)
console.log(`TOP-LEVEL \`$id\` documents  ${hits.length}`)
for (const hit of hits) {
  console.log(
    `   ${hit.path}\n      value=${JSON.stringify(hit.value)} ` +
      `matchesOwnId=${hit.matchesOwnId} updateTime=${hit.updateTime}`,
  )
}

if (scrubTargets.length === 0) {
  console.log(
    hits.length === 0
      ? '\nClean (and the control proves the sweep could have seen it).'
      : '\nRead-only. Re-run with `--scrub <path> [<path> …>]` to delete the key.',
  )
  process.exit(0)
}

console.log('\n── SCRUB ──────────────────────────────────────────────────────')
for (const target of scrubPlan(scrubTargets)) {
  const ref = db.doc(target.path)
  const before = await ref.get()
  if (!before.exists) {
    console.error(`   ${target.path}: MISSING — not scrubbed`)
    process.exitCode = 1
    continue
  }
  if (!hasPersistedSyntheticId(before.data())) {
    console.log(`   ${target.path}: no \`${target.field}\` key — nothing to do`)
    continue
  }
  const beforeKeys = Object.keys(before.data()).sort()
  // One field, on a raw reference, with a precondition. See the header.
  await ref.update(
    new FieldPath(target.field),
    FieldValue.delete(),
    { lastUpdateTime: before.updateTime },
  )
  const after = await ref.get()
  const afterKeys = Object.keys(after.data()).sort()
  const removed = beforeKeys.filter((key) => !afterKeys.includes(key))
  const added = afterKeys.filter((key) => !beforeKeys.includes(key))
  console.log(`   ${target.path}`)
  console.log(`      before  ${beforeKeys.length} fields: ${beforeKeys.join(', ')}`)
  console.log(`      after   ${afterKeys.length} fields: ${afterKeys.join(', ')}`)
  console.log(`      removed ${JSON.stringify(removed)}  added ${JSON.stringify(added)}`)
  if (removed.length !== 1 || removed[0] !== target.field || added.length !== 0) {
    console.error('      ✖ UNEXPECTED FIELD CHANGE — investigate immediately')
    process.exitCode = 1
  }
}
