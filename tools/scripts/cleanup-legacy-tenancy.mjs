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

// Legacy-tenancy cleanup (AGL-238), run AFTER a parity soak of the org
// model. Deletes the host-level copies of data that migrated to orgs
// (datasets/records, contacts, contactSegments) — but ONLY where the org
// copy verifiably exists (per-item parity check, not a blind wipe).
//
// Deliberately NOT touched here: hosts.admins / hosts.tenantId (still
// read by the rules fallback and the suspension check), the `tenants`
// collection (still written by the Stripe webhook), and the v1 rules
// blocks — those retire together in a later pass once the webhook stops
// dual-writing.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/cleanup-legacy-tenancy.mjs [--apply]

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!projectId || !clientEmail || !privateKey) {
  console.error('Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars')
  process.exit(1)
}
if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}
const db = getFirestore()

let planned = 0
let skipped = 0

for (const host of (await db.collection('hosts').get()).docs) {
  const orgId = host.get('orgId')
  if (!orgId) {
    console.warn(`! hosts/${host.id} has no orgId — nothing cleaned`)
    continue
  }
  const orgRef = db.collection('orgs').doc(orgId)

  // Datasets: delete the host copy only when the org copy (same id) exists.
  for (const dataset of (await host.ref.collection('datasets').get()).docs) {
    const parity = await orgRef.collection('datasets').doc(dataset.id).get()
    if (!parity.exists) {
      console.warn(`! keep hosts/${host.id}/datasets/${dataset.id} — no org copy`)
      skipped += 1
      continue
    }
    console.log(`- delete hosts/${host.id}/datasets/${dataset.id} (org copy verified)`)
    planned += 1
    if (APPLY) await db.recursiveDelete(dataset.ref)
  }

  // Contacts: parity by email in the org list.
  for (const contact of (await host.ref.collection('contacts').get()).docs) {
    const email = String(contact.get('email') ?? '').toLowerCase()
    const parity = email
      ? await orgRef.collection('contacts').where('email', '==', email).limit(1).get()
      : { empty: true }
    if (parity.empty) {
      console.warn(`! keep hosts/${host.id}/contacts/${contact.id} — no org copy`)
      skipped += 1
      continue
    }
    console.log(`- delete hosts/${host.id}/contacts/${contact.id} (${email})`)
    planned += 1
    if (APPLY) await contact.ref.delete()
  }

  // Segments: parity by id.
  for (const segment of (await host.ref.collection('contactSegments').get()).docs) {
    const parity = await orgRef.collection('contactSegments').doc(segment.id).get()
    if (!parity.exists) {
      console.warn(`! keep hosts/${host.id}/contactSegments/${segment.id} — no org copy`)
      skipped += 1
      continue
    }
    console.log(`- delete hosts/${host.id}/contactSegments/${segment.id}`)
    planned += 1
    if (APPLY) await segment.ref.delete()
  }
}

console.log(
  `\n${APPLY ? 'Deleted' : 'Dry run:'} ${planned} migrated item(s)` +
    `${skipped ? `, kept ${skipped} without org parity` : ''}.` +
    (APPLY ? '' : ' Re-run with --apply to delete.'),
)
