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

// Org data migration (AGL-237): copies host-scoped datasets (+records),
// contacts and contactSegments up to their owning org, per the scoping
// decision in docs/MULTI_TENANT_FIRESTORE.md §11. Contacts merge by
// email across the org's hosts. Host copies are left in place (the code
// reads org paths once hostIndex resolves; leftovers are deleted with
// the AGL-238 cleanup). Idempotent: existing org docs win.
//
// RUN THIS TOGETHER WITH DEPLOYING THE AGL-237 CODE — once hostIndex
// resolves, reads and writes go to the org paths.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/migrate-org-data.mjs [--apply]

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')
const INTERACTIONS_CAP = 50

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

const hosts = (await db.collection('hosts').get()).docs
let plans = 0

for (const host of hosts) {
  const orgId = host.get('orgId')
  if (!orgId) {
    console.warn(`! hosts/${host.id} has no orgId — run backfill-orgs first; skipped`)
    continue
  }
  const orgRef = db.collection('orgs').doc(orgId)

  // Datasets + records: copy by id; an existing org dataset wins.
  const datasets = await host.ref.collection('datasets').get()
  for (const dataset of datasets.docs) {
    const target = orgRef.collection('datasets').doc(dataset.id)
    const exists = (await target.get()).exists
    const records = await dataset.ref.collection('records').get()
    console.log(
      `${exists ? '= keep ' : '+ copy '} dataset ${dataset.get('name') ?? dataset.id} ` +
        `(${records.size} records) hosts/${host.id} → orgs/${orgId}`,
    )
    plans += 1
    if (!APPLY || exists) continue
    await target.set({ ...dataset.data(), sourceHostId: host.id })
    for (const record of records.docs) {
      await target.collection('records').doc(record.id).set(record.data())
    }
  }

  // Contacts: merge by normalized email into the org list.
  const contacts = await host.ref.collection('contacts').get()
  for (const contact of contacts.docs) {
    const email = String(contact.get('email') ?? '').toLowerCase()
    if (!email) continue
    const match = await orgRef
      .collection('contacts')
      .where('email', '==', email)
      .limit(1)
      .get()
    console.log(
      `${match.empty ? '+ copy ' : '~ merge'} contact ${email} hosts/${host.id} → orgs/${orgId}`,
    )
    plans += 1
    if (!APPLY) continue
    if (match.empty) {
      await orgRef
        .collection('contacts')
        .add({ ...contact.data(), hostId: host.id })
    } else {
      const existing = match.docs[0]
      const interactions = [
        ...(existing.get('interactions') ?? []),
        ...(contact.get('interactions') ?? []),
      ]
        .sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0))
        .slice(-INTERACTIONS_CAP)
      await existing.ref.set(
        {
          sources: { ...(contact.get('sources') ?? {}), ...(existing.get('sources') ?? {}) },
          interactions,
          ...(existing.get('name') ? {} : contact.get('name') ? { name: contact.get('name') } : {}),
        },
        { merge: true },
      )
    }
  }

  // Segments: copy by id; existing org segment wins.
  const segments = await host.ref.collection('contactSegments').get()
  for (const segment of segments.docs) {
    const target = orgRef.collection('contactSegments').doc(segment.id)
    const exists = (await target.get()).exists
    console.log(
      `${exists ? '= keep ' : '+ copy '} segment ${segment.get('name') ?? segment.id} → orgs/${orgId}`,
    )
    plans += 1
    if (APPLY && !exists) {
      await target.set({ ...segment.data(), sourceHostId: host.id })
    }
  }
}

console.log(
  APPLY
    ? `\nMigrated ${plans} item(s).`
    : `\nDry run: ${plans} item(s) planned. Re-run with --apply to write.`,
)
