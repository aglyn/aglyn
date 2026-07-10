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

// AGL-238 final retirement: with every read/write path re-keyed to orgs
// (webhook, entitlement gates, rules, staff console), this removes the
// now-dead legacy billing v1 data:
//
//   1. hosts/*: the `admins` map and `tenantId` field (memberRoles is the
//      only authority the rules read).
//   2. supportTickets/*: stamps `orgId` on tickets that only carry the
//      legacy `tenantId` (owner-uid) so they keep listing for their org.
//   3. tenants/* docs and their subcollections (members, roles,
//      usageRollups) — after checking every host's org has a doc.
//
// SAFETY: refuses to touch tenants/* unless every host with data resolves
// to an existing org (parity check). Dry-run by default; pass --apply to
// write. Uses the root .env service account:
//
//   set -a && source .env && set +a && \
//     node tools/scripts/retire-legacy-tenants.mjs [--apply]

import { cert, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const apply = process.argv.includes('--apply')

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!projectId || !clientEmail || !privateKey) {
  console.error('Missing FIREBASE_* service-account env vars (source .env).')
  process.exit(1)
}
initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
const firestore = getFirestore()

async function deleteSubcollections(docRef) {
  const subcollections = await docRef.listCollections()
  for (const subcollection of subcollections) {
    const docs = await subcollection.listDocuments()
    for (const subdoc of docs) {
      await deleteSubcollections(subdoc)
      if (apply) await subdoc.delete()
    }
  }
}

const hosts = await firestore.collection('hosts').get()
const orgIds = new Set()
let missingOrg = 0
for (const host of hosts.docs) {
  const orgId = host.get('orgId')
  if (!orgId) {
    console.error(`PARITY FAIL: hosts/${host.id} has no orgId`)
    missingOrg += 1
    continue
  }
  orgIds.add(orgId)
}
for (const orgId of orgIds) {
  const org = await firestore.collection('orgs').doc(orgId).get()
  if (!org.exists) {
    console.error(`PARITY FAIL: orgs/${orgId} missing (referenced by hosts)`)
    missingOrg += 1
  }
}
if (missingOrg > 0) {
  console.error(`\n${missingOrg} parity failure(s) — aborting, nothing written.`)
  process.exit(1)
}
console.log(`Parity OK: ${hosts.size} hosts across ${orgIds.size} orgs.\n`)

// 1) Strip the legacy fields from host docs.
let strippedHosts = 0
for (const host of hosts.docs) {
  const hasLegacy =
    host.get('admins') !== undefined || host.get('tenantId') !== undefined
  if (!hasLegacy) continue
  strippedHosts += 1
  console.log(`hosts/${host.id}: drop admins + tenantId`)
  if (apply) {
    await host.ref.update({
      admins: FieldValue.delete(),
      tenantId: FieldValue.delete(),
    })
  }
}

// 2) Re-key legacy support tickets to the owner's org.
const tickets = await firestore.collection('supportTickets').get()
let rekeyedTickets = 0
for (const ticket of tickets.docs) {
  if (ticket.get('orgId')) continue
  const tenantId = ticket.get('tenantId')
  if (!tenantId) continue
  const membership = await firestore
    .collection('users')
    .doc(String(tenantId))
    .collection('orgs')
    .limit(1)
    .get()
  const orgId = membership.empty ? null : membership.docs[0].id
  if (!orgId) {
    console.warn(`supportTickets/${ticket.id}: no org for ${tenantId}, skipped`)
    continue
  }
  rekeyedTickets += 1
  console.log(`supportTickets/${ticket.id}: orgId=${orgId}`)
  if (apply) {
    await ticket.ref.set(
      { orgId, tenantId: FieldValue.delete() },
      { merge: true },
    )
  }
}

// 3) Delete the tenants collection (docs + members/roles/usageRollups).
const tenants = await firestore.collection('tenants').listDocuments()
for (const tenantRef of tenants) {
  console.log(`tenants/${tenantRef.id}: delete (with subcollections)`)
  await deleteSubcollections(tenantRef)
  if (apply) await tenantRef.delete()
}

console.log(
  `\n${apply ? 'Applied' : 'DRY RUN (pass --apply to write)'}: ` +
    `${strippedHosts} hosts stripped, ${rekeyedTickets} tickets re-keyed, ` +
    `${tenants.length} tenant docs deleted.`,
)
