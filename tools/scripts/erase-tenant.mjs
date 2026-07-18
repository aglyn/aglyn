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

// GDPR erasure (AGL-206 / AGL-485). Deliberately manual and heavily guarded:
//
//   1. An erasure request is filed — by staff in the admin console, or by
//      an org owner via self-serve "Delete organization" — which sets
//      `orgs/{orgId}.erasureRequestedAt` (audited). Reversible until the
//      hold elapses.
//   2. After a 7-day hold, staff run this script. Without --confirm it only
//      prints the deletion plan. With --confirm it writes a final JSON
//      export first, then permanently deletes.
//
// TWO modes:
//   --org <orgId>      Org-scoped erasure (the current model): erases the
//                      org, its hosts (Firestore + Storage), hostIndex,
//                      slug, org-level Storage, and its Stripe customer.
//                      Member back-references are cleaned up. Reads the
//                      erasure flag/hold from the ORG doc.
//   --tenant <uid>     Legacy per-user erasure: the user's `tenants/{uid}`
//                      doc + hosts + owned orgs + the Firebase Auth user.
//
// The script REFUSES when there's no erasureRequestedAt, the hold hasn't
// elapsed, or the target doc is missing.
//
// Usage:
//   node tools/scripts/erase-tenant.mjs --org <orgId> [--confirm]
//   node tools/scripts/erase-tenant.mjs --tenant <uid> [--confirm]

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { writeFileSync } from 'node:fs'

const HOLD_MS = 7 * 24 * 60 * 60 * 1000

/** Best-effort Stripe customer deletion (PII lives at Stripe too). */
async function deleteStripeCustomer(customerId) {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key || !customerId) return
  try {
    const response = await fetch(
      `https://api.stripe.com/v1/customers/${customerId}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${key}` } },
    )
    if (!response.ok) {
      console.warn(`Stripe customer ${customerId} delete: HTTP ${response.status}`)
    } else {
      console.log(`Deleted Stripe customer ${customerId}`)
    }
  } catch (error) {
    console.warn(`Stripe customer ${customerId} delete failed:`, error.message)
  }
}

/** Delete every object under a Storage prefix, fail-soft. */
async function clearStoragePrefix(prefix) {
  try {
    await getStorage().bucket().deleteFiles({ prefix })
    console.log(`Storage cleared: ${prefix}`)
  } catch (error) {
    console.warn(`Storage cleanup failed for ${prefix}:`, error.message)
  }
}

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

/** Shared hold/flag guard; exits the process on refusal. */
function assertErasable(label, requestedAt) {
  const requestedMs = requestedAt?.toMillis?.() ?? null
  if (!requestedMs) {
    console.error(
      `REFUSED: no erasure request on ${label}. File it (admin console or ` +
        'self-serve) first, then wait out the 7-day hold.',
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
}

/**
 * Org-scoped erasure (AGL-485) — the current model. Deletes the org, its
 * hosts (Firestore + Storage), hostIndex/slug, org-level Storage, and the
 * org's Stripe customer; cleans up members' back-references. Does NOT
 * delete member Auth accounts — a member may belong to other orgs.
 */
async function eraseOrg(firestore, orgId, confirmFlag) {
  const orgRef = firestore.collection('orgs').doc(orgId)
  const orgSnapshot = await orgRef.get()
  if (!orgSnapshot.exists) {
    console.error(`REFUSED: orgs/${orgId} does not exist.`)
    process.exit(1)
  }
  assertErasable(`orgs/${orgId}`, orgSnapshot.get('erasureRequestedAt'))

  const hosts = await firestore
    .collection('hosts')
    .where('orgId', '==', orgId)
    .get()
  const members = await orgRef.collection('members').get()
  const slug = orgSnapshot.get('slug')
  const stripeCustomerId = orgSnapshot.get('stripeCustomerId')
  console.log(
    `orgs/${orgId} (${orgSnapshot.get('name') ?? ''}): ${hosts.size} host(s), ` +
      `${members.size} member(s)${slug ? `, slug ${slug}` : ''}` +
      `${stripeCustomerId ? `, Stripe ${stripeCustomerId}` : ''}`,
  )
  for (const host of hosts.docs) {
    console.log(`  - hosts/${host.id} (${host.get('displayName') ?? ''})`)
  }

  if (!confirmFlag) {
    console.log(
      '\nDry run — nothing deleted. Re-run with --confirm to export a final ' +
        'bundle and PERMANENTLY delete the org, its sites, files, and data.',
    )
    return
  }

  // Final export first — erasure must never be a data's only ending.
  const exportPayload = {
    exportedAt: new Date().toISOString(),
    org: await exportDocTree(firestore, orgRef),
    hosts: await Promise.all(
      hosts.docs.map((host) => exportDocTree(firestore, host.ref)),
    ),
  }
  const exportPath = `erasure-org-${orgId}-${Date.now()}.json`
  writeFileSync(exportPath, JSON.stringify(exportPayload))
  console.log(`Final export written: ${exportPath}`)

  // Hosts: Storage + routing index, then the Firestore tree.
  for (const host of hosts.docs) {
    await clearStoragePrefix(`hosts/${host.id}/`)
    await firestore.collection('hostIndex').doc(host.id).delete()
    await firestore.recursiveDelete(host.ref)
    console.log(`Deleted hosts/${host.id}`)
  }
  // Org-level Storage (media/dataset assets outside the host prefix).
  await clearStoragePrefix(`orgs/${orgId}/`)
  // Stripe customer (PII at the processor).
  await deleteStripeCustomer(stripeCustomerId)
  // Members' reverse index into this org.
  for (const member of members.docs) {
    await firestore
      .collection('users')
      .doc(member.id)
      .collection('orgs')
      .doc(orgId)
      .delete()
      .catch(() => undefined)
  }
  // The org subtree + slug reservation.
  await firestore.recursiveDelete(orgRef)
  if (slug) await firestore.collection('orgSlugs').doc(slug).delete()
  console.log(`Deleted orgs/${orgId}`)

  await firestore.collection('adminAudit').add({
    actorUid: 'script:erase-tenant',
    action: 'org.erased',
    target: `orgs/${orgId}`,
    before: { hosts: hosts.size, members: members.size },
    after: { exportPath },
    at: FieldValue.serverTimestamp(),
  })
  console.log('Org erasure complete (audited).')
}

async function eraseTenant(firestore, tenantId, confirmFlag) {
  const tenantRef = firestore.collection('tenants').doc(tenantId)
  const tenant = await tenantRef.get()
  if (!tenant.exists) {
    console.error(`REFUSED: tenant ${tenantId} does not exist.`)
    process.exit(1)
  }
  assertErasable(`tenants/${tenantId}`, tenant.get('erasureRequestedAt'))

  const hosts = await firestore
    .collection('hosts')
    .where('tenantId', '==', tenantId)
    .get()
  console.log(`Tenant ${tenantId}: ${hosts.size} host(s) to erase`)
  for (const host of hosts.docs) {
    console.log(`  - hosts/${host.id} (${host.get('displayName') ?? ''})`)
  }

  // Org tenancy (AGL-233): plan the user's org footprint. Solely-owned
  // orgs are erased with them (subtree + slug + hostIndex); memberships in
  // shared orgs are removed; orgs they OWN that still have other members
  // are skipped loudly — transfer ownership first.
  const membershipEntries = await firestore
    .collection('users')
    .doc(tenantId)
    .collection('orgs')
    .get()
  const orgPlans = []
  for (const entry of membershipEntries.docs) {
    const orgRef = firestore.collection('orgs').doc(entry.id)
    const orgSnapshot = await orgRef.get()
    if (!orgSnapshot.exists) {
      orgPlans.push({ orgRef, mode: 'index-only' })
      continue
    }
    const isOwner = orgSnapshot.get('ownerUid') === tenantId
    const members = await orgRef.collection('members').get()
    const others = members.docs.filter((member) => member.id !== tenantId)
    const mode = !isOwner
      ? 'leave'
      : others.length === 0
        ? 'delete-org'
        : 'skip-shared'
    orgPlans.push({ orgRef, orgSnapshot, mode })
    console.log(
      `  - orgs/${entry.id} (${orgSnapshot.get('name') ?? ''}): ${mode}` +
        (mode === 'skip-shared'
          ? ` — ${others.length} other member(s), transfer ownership first`
          : ''),
    )
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
    orgs: await Promise.all(
      orgPlans
        .filter((plan) => plan.mode === 'delete-org')
        .map((plan) => exportDocTree(firestore, plan.orgRef)),
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

  // The Firebase Auth account (this legacy mode erases a whole user).
  try {
    await getAuth().deleteUser(tenantId)
    console.log(`Deleted auth user ${tenantId}`)
  } catch (error) {
    console.warn(`Auth user ${tenantId} delete failed:`, error.message)
  }

  // Org cleanup per the plan above.
  for (const plan of orgPlans) {
    const orgId = plan.orgRef.id
    if (plan.mode === 'skip-shared') {
      console.warn(
        `SKIPPED orgs/${orgId}: other members remain — transfer ownership, ` +
          'then re-run for the org.',
      )
      continue
    }
    if (plan.mode === 'delete-org') {
      const slug = plan.orgSnapshot?.get('slug')
      const orgHostIds = Object.keys(plan.orgSnapshot?.get('hosts') ?? {})
      for (const hostId of orgHostIds) {
        await firestore.collection('hostIndex').doc(hostId).delete()
      }
      await firestore.recursiveDelete(plan.orgRef)
      if (slug) await firestore.collection('orgSlugs').doc(slug).delete()
      console.log(`Deleted orgs/${orgId} (slug: ${slug ?? '—'})`)
    } else if (plan.mode === 'leave') {
      // Membership in someone else's org: member doc + stale projection.
      await plan.orgRef.collection('members').doc(tenantId).delete()
      const orgHostIds = Object.keys(plan.orgSnapshot?.get('hosts') ?? {})
      for (const hostId of orgHostIds) {
        await firestore
          .collection('hosts')
          .doc(hostId)
          .set(
            { memberRoles: { [tenantId]: FieldValue.delete() } },
            { merge: true },
          )
      }
      console.log(`Left orgs/${orgId}`)
    }
    await firestore
      .collection('users')
      .doc(tenantId)
      .collection('orgs')
      .doc(orgId)
      .delete()
  }

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

async function main() {
  const args = process.argv.slice(2)
  const confirmFlag = args.includes('--confirm')
  const orgFlag = args.indexOf('--org')
  const orgId = orgFlag >= 0 ? args[orgFlag + 1] : null
  const tenantFlag = args.indexOf('--tenant')
  const tenantId = tenantFlag >= 0 ? args[tenantFlag + 1] : null
  if (!orgId && !tenantId) {
    console.error(
      'Usage: node tools/scripts/erase-tenant.mjs (--org <orgId> | ' +
        '--tenant <uid>) [--confirm]',
    )
    process.exit(1)
  }

  initAdmin()
  const firestore = getFirestore()
  if (orgId) {
    await eraseOrg(firestore, orgId, confirmFlag)
  } else {
    await eraseTenant(firestore, tenantId, confirmFlag)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
