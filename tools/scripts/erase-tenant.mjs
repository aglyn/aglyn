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

// GDPR tenant erasure (AGL-206). Deliberately manual and heavily guarded:
//
//   1. Staff request erasure in the admin console (sets
//      tenant.erasureRequestedAt, audited).
//   2. After a 7-day hold, staff run this script. Without --confirm it
//      only prints the deletion plan. With --confirm it first writes a
//      JSON export of every host + tenant doc next to the script output,
//      then recursively deletes hosts (Firestore subcollections + Storage
//      files under hosts/{hostId}/) and finally the tenant doc, leaving a
//      terminal adminAudit entry.
//
// The script REFUSES when: no erasureRequestedAt, the hold hasn't
// elapsed, or the tenant doc is missing.
//
// Usage:
//   node tools/scripts/erase-tenant.mjs --tenant <tenantId> [--confirm]

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { writeFileSync } from 'node:fs'

const HOLD_MS = 7 * 24 * 60 * 60 * 1000

function initAdmin() {
  if (getApps().length) return
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!projectId || !clientEmail || !privateKey) {
    console.error(
      'Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY',
    )
    process.exit(1)
  }
  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  })
}

async function exportDocTree(firestore, ref) {
  const snapshot = await ref.get()
  const result = { _id: ref.id, data: snapshot.exists ? snapshot.data() : null }
  const collections = await ref.listCollections()
  for (const collectionRef of collections) {
    const docs = await collectionRef.get()
    result[collectionRef.id] = await Promise.all(
      docs.docs.map((docSnapshot) => exportDocTree(firestore, docSnapshot.ref)),
    )
  }
  return result
}

async function main() {
  const args = process.argv.slice(2)
  const confirmFlag = args.includes('--confirm')
  const tenantFlag = args.indexOf('--tenant')
  const tenantId = tenantFlag >= 0 ? args[tenantFlag + 1] : null
  if (!tenantId) {
    console.error(
      'Usage: node tools/scripts/erase-tenant.mjs --tenant <tenantId> [--confirm]',
    )
    process.exit(1)
  }

  initAdmin()
  const firestore = getFirestore()
  const tenantRef = firestore.collection('tenants').doc(tenantId)
  const tenant = await tenantRef.get()
  if (!tenant.exists) {
    console.error(`REFUSED: tenant ${tenantId} does not exist.`)
    process.exit(1)
  }
  const requestedAt = tenant.get('erasureRequestedAt')
  const requestedMs = requestedAt?.toMillis?.() ?? null
  if (!requestedMs) {
    console.error(
      'REFUSED: no erasure request on this tenant. Request it from the ' +
        'admin console first (audited), then wait out the 7-day hold.',
    )
    process.exit(1)
  }
  const heldMs = Date.now() - requestedMs
  if (heldMs < HOLD_MS) {
    const daysLeft = Math.ceil((HOLD_MS - heldMs) / 86400000)
    console.error(
      `REFUSED: the 7-day hold has ${daysLeft} day(s) remaining ` +
        `(requested ${new Date(requestedMs).toISOString()}).`,
    )
    process.exit(1)
  }

  const hosts = await firestore
    .collection('hosts')
    .where('tenantId', '==', tenantId)
    .get()
  console.log(`Tenant ${tenantId}: ${hosts.size} host(s) to erase`)
  for (const host of hosts.docs) {
    console.log(`  - hosts/${host.id} (${host.get('displayName') ?? ''})`)
  }

  if (!confirmFlag) {
    console.log(
      '\nDry run — nothing deleted. Re-run with --confirm to export a ' +
        'final bundle and PERMANENTLY delete everything listed above.',
    )
    return
  }

  // Final export first — erasure must never be the only copy's end.
  const exportPayload = {
    exportedAt: new Date().toISOString(),
    tenant: await exportDocTree(firestore, tenantRef),
    hosts: await Promise.all(
      hosts.docs.map((host) => exportDocTree(firestore, host.ref)),
    ),
  }
  const exportPath = `erasure-${tenantId}-${Date.now()}.json`
  writeFileSync(exportPath, JSON.stringify(exportPayload))
  console.log(`Final export written: ${exportPath}`)

  // Storage files per host, then Firestore trees, then the tenant doc.
  for (const host of hosts.docs) {
    try {
      await getStorage()
        .bucket()
        .deleteFiles({ prefix: `hosts/${host.id}/` })
      console.log(`Storage cleared: hosts/${host.id}/`)
    } catch (error) {
      console.warn(`Storage cleanup failed for ${host.id}:`, error.message)
    }
    await firestore.recursiveDelete(host.ref)
    console.log(`Deleted hosts/${host.id}`)
  }
  await firestore.recursiveDelete(tenantRef)
  console.log(`Deleted tenants/${tenantId}`)

  await firestore.collection('adminAudit').add({
    actorUid: `script:erase-tenant`,
    action: 'tenant.erased',
    target: `tenants/${tenantId}`,
    before: { hosts: hosts.size },
    after: { exportPath },
    at: FieldValue.serverTimestamp(),
  })
  console.log('Erasure complete (audited).')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
