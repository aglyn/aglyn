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

// AGL-1028, FINAL STEP: delete the inline `stripeCustomerId` / `subscription`
// from `orgs/{orgId}`. This is the step that actually closes the exposure —
// everything before it was additive, and a scoped site collaborator could still
// read the keys off the org doc.
//
// PRECONDITIONS, and this script refuses to run without them:
//
//  1. `writeOrgBilling` must already default `writeInline` to FALSE and be
//     DEPLOYED. Otherwise the next `customer.subscription.updated` re-adds the
//     fields minutes from now and the exposure reopens silently.
//  2. Each org's `billing/stripe` doc must already hold the same values. This
//     script compares field by field and SKIPS any org that does not match,
//     rather than trusting that the backfill ran.
//
// Every skip is reported. A non-zero skip count is a reason to stop and look,
// not a reason to re-run with more force.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/drop-inline-org-billing.mjs [--apply]
//
// Dry-run by default. Writes a JSON snapshot of everything it deletes into the
// OS temp dir — never the working tree, since it carries live Stripe customer
// ids — so the change is reversible by hand.

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APPLY = process.argv.includes('--apply')

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!projectId || !clientEmail || !privateKey) {
  console.error('Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY')
  process.exit(1)
}
if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}
const db = getFirestore(process.env.FIRESTORE_DATABASE_ID)

const ORG_BILLING_SUBCOLLECTION = 'billing'
const ORG_BILLING_DOC_ID = 'stripe'
const MOVED_KEYS = ['stripeCustomerId', 'subscription']

/** Structural compare — the values are plain data (strings, maps, timestamps). */
const same = (a, b) => {
  if (a === b) return true
  if (a == null || b == null) return a == null && b == null
  // Firestore Timestamps compare by their millisecond value.
  if (typeof a?.toMillis === 'function' && typeof b?.toMillis === 'function') {
    return a.toMillis() === b.toMillis()
  }
  if (typeof a !== 'object' || typeof b !== 'object') return false
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  return ak.every((k) => same(a[k], b[k]))
}

const stats = { orgs: 0, dropped: 0, nothingInline: 0, skipped: 0 }
const skips = []
const snapshot = {}

for (const orgDoc of (await db.collection('orgs').get()).docs) {
  stats.orgs += 1
  const data = orgDoc.data()
  const inline = {}
  for (const key of MOVED_KEYS) {
    if (data[key] !== undefined) inline[key] = data[key]
  }
  if (!Object.keys(inline).length) {
    stats.nothingInline += 1
    continue
  }

  const billing = await orgDoc.ref
    .collection(ORG_BILLING_SUBCOLLECTION)
    .doc(ORG_BILLING_DOC_ID)
    .get()
  if (!billing.exists) {
    stats.skipped += 1
    skips.push(`${data.slug ?? orgDoc.id}: no billing doc — run the backfill first`)
    continue
  }
  const moved = billing.data() ?? {}

  const mismatched = Object.keys(inline).filter((k) => !same(inline[k], moved[k]))
  if (mismatched.length) {
    stats.skipped += 1
    skips.push(
      `${data.slug ?? orgDoc.id}: billing doc disagrees on ${mismatched.join(', ')} — NOT deleting`,
    )
    continue
  }

  snapshot[orgDoc.id] = { slug: data.slug ?? null, ...inline }
  if (APPLY) {
    const patch = {}
    for (const key of Object.keys(inline)) patch[key] = FieldValue.delete()
    await orgDoc.ref.update(patch)
  }
  stats.dropped += 1
}

if (Object.keys(snapshot).length) {
  // Deliberately OUTSIDE the repo: this file contains live Stripe customer ids
  // and subscription detail, and a snapshot dropped in the working tree is one
  // `git add -A` away from being published.
  const file = join(
    tmpdir(),
    `aglyn-inline-billing-snapshot-${Object.keys(snapshot).length}.json`,
  )
  writeFileSync(file, JSON.stringify(snapshot, null, 2))
  console.log(`snapshot written to ${file}\n`)
}

console.log(APPLY ? 'APPLIED' : 'DRY RUN — nothing written (pass --apply)')
console.log(`  orgs scanned                 ${stats.orgs}`)
console.log(`  inline fields dropped        ${stats.dropped}`)
console.log(`  had nothing inline           ${stats.nothingInline}`)
console.log(`  SKIPPED (billing mismatch)   ${stats.skipped}`)
for (const line of skips) console.log(`    ! ${line}`)
process.exit(stats.skipped ? 1 : 0)
