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

// Removes RETIRED numeric entitlement overrides from live org documents
// (AGL-2133). DRY RUN by default; `--apply` writes.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/strip-retired-entitlements.mjs [--apply]
//
// Why this exists. `totalSiteSizeMb` was a staff-writable quota that nothing
// enforced, so support engineers raised it on real orgs, got a success and an
// audit row, and changed nothing. Retiring it removes the field from the
// dialog and the key from every plan — but the numbers already written to
// `orgs/{id}.entitlements` stay where they are. `resolveOrgEntitlements`
// drops them at read time (`RETIRED_ENTITLEMENT_KEYS`), so nothing can
// resolve one, and this clears them at rest so an operator reading the raw
// document is not looking at a cap that has not existed for months.
//
// The retired list is DUPLICATED here rather than imported: this is a plain
// .mjs run against production with no build step, and every other script in
// this directory does the same. `quota-enforced-somewhere.spec.ts` is what
// keeps a retirement from being half-done in the app; the check below is what
// keeps this file from silently falling behind it.
//
// `FieldValue.delete()`, not a write of `null` or `0`: a zero is a REAL cap
// meaning "none allowed" (AGL-1789), so writing one would turn a dead field
// into a live refusal on the day someone wires the key back up.

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const apply = process.argv.includes('--apply')

const HERE = dirname(fileURLToPath(import.meta.url))
const PLAN_MODEL = join(
  HERE,
  '../../libs/aglyn/src/lib/app-utils/plan-entitlements.ts',
)

/** Keys removed from `PLAN_ENTITLEMENTS` and stripped by the resolver. */
const RETIRED = ['totalSiteSizeMb']

// Read back from the source of truth so this list cannot rot unnoticed. A
// key retired in the app but missing here would leave its values on every
// org, which is the exact orphan this script exists to prevent.
const planModel = readFileSync(PLAN_MODEL, 'utf8')
const declared = (
  planModel.match(
    /RETIRED_ENTITLEMENT_KEYS: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\)/,
  )?.[1] ?? ''
)
  .split(',')
  .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
  .filter(Boolean)

const missing = declared.filter((key) => !RETIRED.includes(key))
if (missing.length) {
  console.error(
    `RETIRED_ENTITLEMENT_KEYS declares keys this script does not strip: ${missing.join(', ')}`,
  )
  process.exit(1)
}
if (!declared.length) {
  console.error(
    'Could not read RETIRED_ENTITLEMENT_KEYS from the plan model — refusing ' +
      'to run against a list that may be stale.',
  )
  process.exit(1)
}

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!projectId || !clientEmail || !privateKey) {
  console.error(
    'Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars',
  )
  process.exit(1)
}

if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}

const firestore = getFirestore()

let scanned = 0
const affected = []

let cursor
for (;;) {
  let page = firestore.collection('orgs').orderBy('__name__').limit(200)
  if (cursor) page = page.startAfter(cursor)
  const snapshot = await page.get()
  if (snapshot.empty) break
  for (const doc of snapshot.docs) {
    scanned += 1
    const entitlements = doc.get('entitlements')
    if (!entitlements || typeof entitlements !== 'object') continue
    const present = RETIRED.filter((key) => entitlements[key] !== undefined)
    if (present.length) {
      affected.push({ id: doc.id, keys: present, values: present.map((k) => entitlements[k]) })
    }
  }
  cursor = snapshot.docs[snapshot.size - 1]
  if (snapshot.size < 200) break
}

console.log(`Scanned ${scanned} org documents.`)
if (!affected.length) {
  console.log('No retired entitlement overrides found. Nothing to do.')
  process.exit(0)
}

console.log(`\n${affected.length} org(s) carry a retired override:`)
for (const row of affected) {
  console.log(
    `  ${row.id}  ${row.keys.map((k, i) => `${k}=${row.values[i]}`).join(', ')}`,
  )
}

if (!apply) {
  console.log('\nDRY RUN — re-run with --apply to remove them.')
  process.exit(0)
}

// One update per org rather than a single batch: 500 is the batch ceiling and
// the affected set is unbounded, and a partial failure here is harmless
// (nothing reads the field either way), so the simple form is the right one.
let written = 0
for (const row of affected) {
  await firestore
    .collection('orgs')
    .doc(row.id)
    .update(
      Object.fromEntries(
        row.keys.map((key) => [`entitlements.${key}`, FieldValue.delete()]),
      ),
    )
  written += 1
}
console.log(`\nRemoved retired overrides from ${written} org(s).`)
