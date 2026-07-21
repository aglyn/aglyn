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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { isValidPublisherHandle } from '../model/community'

/** `publisherProfiles/{orgId}` — the org's marketplace identity (AGL-652). */
export const PUBLISHER_PROFILES = 'publisherProfiles'
/** `publisherHandles/{handle}` — uniqueness reservations. */
export const PUBLISHER_HANDLES = 'publisherHandles'

export interface ResolvedPublisher {
  orgId: string
  handle: string
  displayName?: string
  stripeAccountId?: string
  stripeChargesEnabled?: boolean
}

/**
 * Load the publishing org's marketplace profile (AGL-652).
 *
 * Publishing is org-only: the publisher is the ORG, not the person who
 * happened to click publish. Every publish route resolves through here so
 * they can't drift on which identity a listing is attributed to.
 *
 * Returns `null` when the org has no profile yet — callers turn that into a
 * 412 telling the user to set one up, matching the previous behaviour when a
 * personal profile was missing.
 */
export async function resolvePublisherProfile(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<ResolvedPublisher | null> {
  const snapshot = await firestore.collection(PUBLISHER_PROFILES).doc(orgId).get()
  const handle = snapshot.get('handle') as string | undefined
  if (!snapshot.exists || !handle) return null
  return {
    orgId,
    handle,
    displayName: snapshot.get('displayName') as string | undefined,
    stripeAccountId: snapshot.get('stripeAccountId') as string | undefined,
    stripeChargesEnabled: snapshot.get('stripeChargesEnabled') === true,
  }
}

/**
 * Whether a user may act for a publishing org (AGL-652).
 *
 * Ownership checks used to read `listing.profileId === decoded.uid`. With
 * org-owned listings that comparison can NEVER be true — a uid is not an org
 * id — so leaving them would lock every publisher out of their own listing
 * and make every paid listing chargeable to its own publisher. Managers
 * (owner/admin) act for the org, matching the gate the profile rules apply.
 */
export async function canActAsPublisher(
  firestore: FirebaseFirestore.Firestore,
  uid: string,
  publisherOrgId: string | undefined | null,
): Promise<boolean> {
  if (!uid || !publisherOrgId) return false
  const member = await firestore
    .collection('orgs')
    .doc(publisherOrgId)
    .collection('members')
    .doc(uid)
    .get()
  const role = member.get('role')
  return role === 'owner' || role === 'admin'
}

export class PublisherHandleTakenError extends Error {
  constructor(public readonly handle: string) {
    super(`Handle "${handle}" is already taken`)
    this.name = 'PublisherHandleTakenError'
  }
}

/**
 * Claim a marketplace handle for an org, transactionally (AGL-652).
 *
 * Mirrors the `orgSlugs` reservation: the read and the write share one
 * transaction, so two orgs racing for the same handle can't both win — which
 * a read-then-write check permits, and which the marketplace URL space cannot
 * represent. A handle the org already holds is a no-op, so this is safe to
 * call on every profile save.
 *
 * A renamed handle leaves a `movedTo` tombstone behind so old marketplace
 * links can still resolve, and re-claiming a tombstone you own is allowed.
 *
 * @throws PublisherHandleTakenError when another org holds it.
 */
export async function claimPublisherHandle(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  handle: string,
  previousHandle?: string,
): Promise<void> {
  if (!isValidPublisherHandle(handle)) {
    throw new Error(`Invalid publisher handle: ${handle}`)
  }
  await firestore.runTransaction(async (tx) => {
    const ref = firestore.collection(PUBLISHER_HANDLES).doc(handle)
    const existing = await tx.get(ref)
    if (existing.exists && existing.get('orgId') !== orgId) {
      throw new PublisherHandleTakenError(handle)
    }
    // A full set (not merge) clears any `movedTo` tombstone from a previous
    // owner's rename — the same reason the org-slug claim replaces wholesale.
    tx.set(ref, { orgId })
    if (previousHandle && previousHandle !== handle) {
      tx.set(firestore.collection(PUBLISHER_HANDLES).doc(previousHandle), {
        orgId,
        movedTo: handle,
        renamedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
    }
  })
}
