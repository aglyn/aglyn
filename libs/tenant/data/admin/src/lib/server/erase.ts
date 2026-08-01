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
import { deleteHostProjectionForAllMembers } from './host-memberships'
import { detachWorkspaceDomain } from './workspace-domains'
import { authForPool, findUserByUidAcrossPools } from './auth-pools'
import { removeOrgMember } from './organizations'
import { isBillingSubscription } from '@aglyn/aglyn/server'

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
    // Drop every member's reverse-index row for this host (AGL-844); the
    // members still exist here (recursiveDelete of the org, if any, is later).
    await deleteHostProjectionForAllMembers(orgId, hostId).catch(() => undefined)
  }

  // The host document tree (screens/layouts/versions/counters/products/…).
  await firestore.recursiveDelete(hostRef)
}

/**
 * Delete a single resource document *and everything under it* (AGL-945).
 *
 * Firestore does not cascade: deleting `orgs/{o}/datasets/{d}` leaves every
 * `records/{r}` beneath it alive but unreachable from the console — still
 * billed, still matched by the rules (which match subcollection paths
 * independently of the parent), and resurrected wholesale if the parent id
 * is ever reused. Only the Admin SDK has `recursiveDelete`, so the console
 * cards route their deletes through /api/resources/erase, which lands here.
 *
 * Authorization belongs to the caller — this only walks the tree.
 */
export async function eraseSubtree(
  path: readonly [string, string, string, string],
): Promise<void> {
  const firestore = firebaseAdmin.app().firestore()
  const [scope, scopeId, kind, id] = path
  await firestore.recursiveDelete(
    firestore.collection(scope).doc(scopeId).collection(kind).doc(id),
  )
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
    // Release the workspace subdomain too (AGL-1136), or the name stays
    // attached to the project and keeps resolving to a console for an org
    // that no longer exists — and blocks the slug from being claimed again.
    // Best-effort like every other cleanup here: an erasure must not fail
    // because a DNS API did.
    await detachWorkspaceDomain(slug).catch(() => undefined)
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

/** An org that stops a person's account from being erased. */
export interface UserErasureBlocker {
  orgId: string
  orgName: string
  /** Whether the org still bills — the reason a human must intervene. */
  hasLiveSubscription: boolean
  /** Other people who would be stranded if this org lost its owner. */
  otherMembers: number
}

export interface UserErasureCandidateOrg {
  orgId: string
  orgName: string
  ownerUid: string | null
  hasLiveSubscription: boolean
  memberCount: number
}

/**
 * Which orgs block erasing `uid` (AGL-1140).
 *
 * Pure so the policy can be tested without Firestore, because the policy is
 * the part worth arguing about — the deletion itself is mechanical.
 *
 * **Owning an org blocks erasure, always.** Not only when it bills, and not
 * only when other members would be stranded. The alternative — cascading
 * into `eraseOrg` — deletes a workspace, its sites and its data as a side
 * effect of someone closing a personal account, and no consent given to the
 * second act was given to the first. Blocking is recoverable; a cascade is
 * not.
 *
 * A live subscription and stranded members are reported rather than gating,
 * so the message can say WHY this org needs attention instead of a bare
 * refusal — "transfer ownership" is useless advice if you do not know which
 * of eleven workspaces is the problem.
 */
export function userErasureBlockers(
  uid: string,
  orgs: readonly UserErasureCandidateOrg[],
): UserErasureBlocker[] {
  return orgs
    .filter((org) => org.ownerUid === uid)
    .map((org) => ({
      orgId: org.orgId,
      orgName: org.orgName,
      hasLiveSubscription: org.hasLiveSubscription,
      // The owner themselves is a member; anyone beyond that is stranded.
      otherMembers: Math.max(0, org.memberCount - 1),
    }))
}

export interface EraseUserResult {
  ok: boolean
  /** Set when the account was NOT erased. */
  skippedReason?: 'not-found' | 'owns-orgs'
  /** Orgs that must be handed over or deleted first. */
  blockers?: UserErasureBlocker[]
  /** What was actually removed, for the audit row and the caller's message. */
  deleted?: { subcollections: string[]; authRecord: boolean; photo: boolean }
}

/**
 * Permanently erase a person's account (AGL-1140).
 *
 * Nothing did this before: `eraseHost`, `eraseSubtree` and `eraseOrg` existed
 * and no path anywhere deleted a `users/{uid}`. That was survivable while the
 * doc held a name and a phone; AGL-1133 added a postal address, and "we have
 * no mechanism to delete it" is a bad answer to an erasure request.
 *
 * `eraseOrg` is deliberately NOT the model here. An org is a workspace with
 * one owner; a person belongs to many orgs, so erasing them must not take
 * anything with it that outlives them.
 *
 * Order matters:
 *   1. Refuse if they own an org — see `userErasureBlockers`.
 *   2. Remove their membership from every org they belong to, so no roster
 *      keeps their email and no host projection keeps granting them access.
 *      This runs BEFORE the profile delete: a half-erased account that still
 *      appears on a roster is worse than one not yet started.
 *   3. Delete the profile subtree, the avatar, then the auth record last —
 *      once that is gone there is no uid to retry with.
 */
export async function eraseUser(uid: string): Promise<EraseUserResult> {
  const firestore = firebaseAdmin.app().firestore()
  const userRef = firestore.collection('users').doc(uid)
  const snapshot = await userRef.get()
  const membership = await userRef.collection('orgs').get()
  // An absent profile doc is not an absent account — the doc is only born on
  // first save (AGL-1127), so the auth record and the org memberships can
  // outlive it. Treat "nothing anywhere" as not-found, not "no doc".
  if (!snapshot.exists && membership.empty) {
    const record = await findUserByUidAcrossPools(uid).catch(() => null)
    if (!record) return { ok: false, skippedReason: 'not-found' }
  }

  const candidates: UserErasureCandidateOrg[] = []
  for (const row of membership.docs) {
    const orgRef = firestore.collection('orgs').doc(row.id)
    const [org, members] = await Promise.all([
      orgRef.get(),
      orgRef.collection('members').count().get(),
    ])
    if (!org.exists) continue
    candidates.push({
      orgId: row.id,
      orgName: String(org.get('name') ?? row.id),
      ownerUid: (org.get('ownerUid') as string | undefined) ?? null,
      hasLiveSubscription: isBillingSubscription(org.data() as never),
      memberCount: Number(members.data().count ?? 0),
    })
  }
  const blockers = userErasureBlockers(uid, candidates)
  if (blockers.length) {
    return { ok: false, skippedReason: 'owns-orgs', blockers }
  }

  // Memberships first — a roster row carries their email and a host
  // projection carries their access, and both outlive the profile doc.
  for (const candidate of candidates) {
    await removeOrgMember(candidate.orgId, uid).catch((error) => {
      console.error(`eraseUser: membership cleanup failed for ${candidate.orgId}`, error)
    })
  }

  // The avatar outlives the doc otherwise.
  let photo = false
  try {
    await storageBucket().deleteFiles({ prefix: `users/${uid}/` })
    photo = true
  } catch (error) {
    console.error(`eraseUser: storage cleanup failed for ${uid}`, error)
  }

  const subcollections = (await userRef.listCollections()).map((c) => c.id)
  await firestore.recursiveDelete(userRef)

  // Auth record LAST: once it is gone there is no uid to retry with, and
  // `authForPool` is required because a project-level delete cannot see an
  // SSO account at all (AGL-1122).
  let authRecord = false
  try {
    const record = await findUserByUidAcrossPools(uid)
    if (record) {
      await authForPool(record.tenantId).deleteUser(uid)
      authRecord = true
    }
  } catch (error) {
    console.error(`eraseUser: auth record delete failed for ${uid}`, error)
  }

  await firestore
    .collection('adminAudit')
    .add({
      actorUid: 'system:erase-user',
      action: 'user.erased',
      target: `users/${uid}`,
      before: { orgs: candidates.length },
      after: { subcollections, authRecord, photo },
      at: FieldValue.serverTimestamp(),
    })
    .catch(() => undefined)

  return { ok: true, deleted: { subcollections, authRecord, photo } }
}
