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

import { FieldValue } from 'firebase-admin/firestore'
import { firebaseAdmin } from './firebase-admin'

/** The reversible hold before a requested erasure is executed (AGL-485). */
export const ERASURE_HOLD_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The admin app is initialized without a default storageBucket, so every
 * bucket access must name it explicitly (same as the media routes). Falls
 * through to the admin default if the env is somehow unset.
 */
function storageBucket() {
  const name = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
  return firebaseAdmin.app().storage().bucket(name || undefined)
}

/**
 * Permanently erase a single site and everything it owns (AGL-488).
 * Unlike deleting the host doc alone (which orphans data), this cleans up
 * every trailing reference:
 *   - Storage objects under `hosts/{hostId}/` (media, CDN variants),
 *   - the `hostIndex/{hostId}` routing entry (subdomain/cname resolution),
 *   - the owning org's `hosts` routing-map entry, and
 *   - the host's Firestore tree (screens, layouts, versions, counters, …)
 *     via `recursiveDelete`.
 *
 * Shared by the self-serve delete-site route and the org-erasure pipeline
 * (AGL-487). Fail-soft on Storage/index cleanup so a partial failure never
 * blocks the Firestore delete; safe to re-run.
 */
export async function eraseHost(hostId: string): Promise<void> {
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const hostSnapshot = await hostRef.get()
  const orgId = hostSnapshot.get('orgId') as string | undefined

  // Storage first (best-effort — the object tree is derived, regenerable).
  try {
    await storageBucket().deleteFiles({ prefix: `hosts/${hostId}/` })
  } catch (error) {
    console.error(`eraseHost: storage cleanup failed for ${hostId}`, error)
  }

  // Routing: the middleware resolves a request to a host via hostIndex and
  // the owning org's hosts map — drop both so the subdomain/cname 404s.
  await firestore
    .collection('hostIndex')
    .doc(hostId)
    .delete()
    .catch(() => undefined)
  if (orgId) {
    await firestore
      .collection('orgs')
      .doc(orgId)
      .set({ hosts: { [hostId]: FieldValue.delete() } }, { merge: true })
      .catch(() => undefined)
  }

  // The host document tree (screens/layouts/versions/counters/products/…).
  await firestore.recursiveDelete(hostRef)
}

type DocRef = FirebaseFirestore.DocumentReference

/** Recursively snapshot a doc + all its subcollections (for the export). */
async function exportDocTree(ref: DocRef): Promise<Record<string, unknown>> {
  const snapshot = await ref.get()
  const result: Record<string, unknown> = {
    _id: ref.id,
    data: snapshot.exists ? snapshot.data() : null,
  }
  const collections = await ref.listCollections()
  for (const collectionRef of collections) {
    const docs = await collectionRef.get()
    result[collectionRef.id] = await Promise.all(
      docs.docs.map((docSnapshot) => exportDocTree(docSnapshot.ref)),
    )
  }
  return result
}

/** Best-effort Stripe customer deletion — PII lives at the processor too. */
async function deleteStripeCustomer(customerId?: string): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key || !customerId) return
  try {
    await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${key}` },
    })
  } catch (error) {
    console.error(`eraseOrg: Stripe customer ${customerId} delete failed`, error)
  }
}

export interface EraseOrgResult {
  ok: boolean
  /** Set when the org was NOT erased (flag missing, hold not elapsed, gone). */
  skippedReason?: string
  /** Storage path of the final export bundle when erased. */
  exportPath?: string
  hosts?: number
}

/**
 * Permanently erase an organization once its 7-day hold has elapsed
 * (AGL-485/487). Runs from the automated cron and the manual staff path.
 * Order matters and every step is defensive:
 *   1. Re-read the org and re-verify erasureRequestedAt + hold — never
 *      delete on a stale/cancelled request.
 *   2. Write a final JSON export (org + host trees) to Storage FIRST — if
 *      the export can't be written, abort without deleting anything.
 *   3. Delete each host (eraseHost), org-level Storage, the Stripe
 *      customer, member back-references, then the org tree + slug.
 *   4. Audit.
 */
export async function eraseOrg(orgId: string): Promise<EraseOrgResult> {
  const firestore = firebaseAdmin.app().firestore()
  const orgRef = firestore.collection('orgs').doc(orgId)
  const orgSnapshot = await orgRef.get()
  if (!orgSnapshot.exists) return { ok: false, skippedReason: 'not-found' }

  const requestedMs = orgSnapshot.get('erasureRequestedAt')?.toMillis?.() ?? null
  if (!requestedMs) return { ok: false, skippedReason: 'no-request' }
  if (Date.now() - requestedMs < ERASURE_HOLD_MS) {
    return { ok: false, skippedReason: 'hold-active' }
  }

  const hosts = await firestore
    .collection('hosts')
    .where('orgId', '==', orgId)
    .get()
  const members = await orgRef.collection('members').get()
  const slug = orgSnapshot.get('slug') as string | undefined
  const stripeCustomerId = orgSnapshot.get('stripeCustomerId') as
    | string
    | undefined

  // Export FIRST — erasure must never be a data's only ending. Abort the
  // whole operation if we can't persist the bundle.
  const bundle = {
    exportedAt: new Date().toISOString(),
    org: await exportDocTree(orgRef),
    hosts: await Promise.all(hosts.docs.map((host) => exportDocTree(host.ref))),
  }
  const exportPath = `erasures/${orgId}/${requestedMs}.json`
  try {
    await storageBucket()
      .file(exportPath)
      .save(Buffer.from(JSON.stringify(bundle)), {
        contentType: 'application/json',
      })
  } catch (error) {
    console.error(`eraseOrg: export write failed for ${orgId}; aborting`, error)
    return { ok: false, skippedReason: 'export-failed' }
  }

  // Hosts (Storage + routing + Firestore trees).
  for (const host of hosts.docs) {
    await eraseHost(host.id)
  }
  // Org-level Storage (media/dataset assets outside the host prefix).
  try {
    await storageBucket().deleteFiles({ prefix: `orgs/${orgId}/` })
  } catch (error) {
    console.error(`eraseOrg: org storage cleanup failed for ${orgId}`, error)
  }
  // Stripe customer.
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
  if (slug) {
    await firestore.collection('orgSlugs').doc(slug).delete().catch(() => undefined)
  }

  await firestore
    .collection('adminAudit')
    .add({
      actorUid: 'cron:run-erasures',
      action: 'org.erased',
      target: `orgs/${orgId}`,
      before: { hosts: hosts.size, members: members.size },
      after: { exportPath },
      at: FieldValue.serverTimestamp(),
    })
    .catch(() => undefined)

  return { ok: true, exportPath, hosts: hosts.size }
}
