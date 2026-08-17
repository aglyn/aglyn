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

// AGL-1028: copy the commercial keys off `orgs/{orgId}` into the manager-gated
// `orgs/{orgId}/billing/stripe`, mirror `billingStatus` back, and stamp the
// `stripeCustomers/{customerId}` reverse index the webhook resolves through.
//
// COPIES, never deletes. The inline fields stay until a separate, later pass
// removes them — every reader still falls back to them, so this script is safe
// to run repeatedly and safe to stop halfway.
//
// Idempotent: re-running rewrites identical data. `--apply` is required to
// write; the default dry run reports exactly what would change.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/backfill-org-billing.mjs [--apply]
//
// Ordering matters and is the thing that has bitten us before: a backfill only
// repairs HISTORY. Every writer has to populate the new location too, or new
// orgs are born with an empty billing doc. Those writers — the Stripe webhook,
// `billing/subscription`, `billing/addons`, `admin/enterprise-billing` — go
// through `writeOrgBilling` and were repointed in the same change as this
// script. Do not run this against a deployment that predates them.

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')

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
const db = getFirestore(process.env.FIRESTORE_DATABASE_ID)

// Kept in sync with `libs/aglyn/src/lib/app-utils/org-billing-doc.ts`. A .mjs
// script cannot import the TS module, so these are duplicated deliberately —
// if the constants there change, change them here.
const ORG_BILLING_SUBCOLLECTION = 'billing'
const ORG_BILLING_DOC_ID = 'stripe'
const STRIPE_CUSTOMER_INDEX_COLLECTION = 'stripeCustomers'
const MOVED_KEYS = ['stripeCustomerId', 'subscription']

const stats = {
  orgs: 0,
  withBilling: 0,
  billingDocsWritten: 0,
  statusMirrored: 0,
  customerIndexWritten: 0,
  alreadyMigrated: 0,
  noBillingData: 0,
}

const orgsSnapshot = await db.collection('orgs').get()
stats.orgs = orgsSnapshot.size

// Batched writes, flushed well under Firestore's 500-op limit. Each org costs
// up to three ops (billing doc, org status mirror, customer index).
let batch = db.batch()
let pending = 0
const flush = async () => {
  // Swap in the fresh batch BEFORE awaiting the full one: `batch` never
  // points at an in-flight commit, which is also what satisfies
  // require-atomic-updates (AGL-1815). Behaviour is unchanged: a dry run or
  // an empty batch is discarded exactly as before, just without the commit.
  const full = batch
  const hadPending = pending > 0
  batch = db.batch()
  pending = 0
  if (!APPLY || !hadPending) return
  await full.commit()
}

for (const orgDoc of orgsSnapshot.docs) {
  const data = orgDoc.data()
  const fields = {}
  for (const key of MOVED_KEYS) {
    if (data[key] !== undefined) fields[key] = data[key]
  }
  if (!Object.keys(fields).length) {
    stats.noBillingData += 1
    continue
  }
  stats.withBilling += 1

  const billingRef = orgDoc.ref
    .collection(ORG_BILLING_SUBCOLLECTION)
    .doc(ORG_BILLING_DOC_ID)
  const existing = await billingRef.get()
  if (existing.exists) stats.alreadyMigrated += 1

  batch.set(billingRef, fields, { merge: true })
  pending += 1
  stats.billingDocsWritten += 1

  // The status mirror the dunning banner and entitlement resolution read.
  const status = fields.subscription?.status
  if (typeof status === 'string' && status) {
    batch.set(orgDoc.ref, { billingStatus: status }, { merge: true })
    pending += 1
    stats.statusMirrored += 1
  }

  // The reverse index that replaced `.where('stripeCustomerId', '==', …)`.
  const customerId = fields.stripeCustomerId
  if (typeof customerId === 'string' && customerId) {
    batch.set(
      db.collection(STRIPE_CUSTOMER_INDEX_COLLECTION).doc(customerId),
      { orgId: orgDoc.id },
      { merge: true },
    )
    pending += 1
    stats.customerIndexWritten += 1
  }

  if (pending >= 400) await flush()
}
await flush()

console.log(APPLY ? 'APPLIED' : 'DRY RUN — nothing written (pass --apply)')
console.log(`  orgs scanned              ${stats.orgs}`)
console.log(`  with billing data         ${stats.withBilling}`)
console.log(`  no billing data (skipped) ${stats.noBillingData}`)
console.log(`  billing docs written      ${stats.billingDocsWritten}`)
console.log(`  billingStatus mirrored    ${stats.statusMirrored}`)
console.log(`  customer index entries    ${stats.customerIndexWritten}`)
console.log(`  already had a billing doc ${stats.alreadyMigrated}`)
process.exit(0)
