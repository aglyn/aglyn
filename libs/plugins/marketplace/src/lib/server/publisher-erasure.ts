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

import type {
  PluginOrgEraser,
  PluginOrgErasureReport,
} from '@aglyn/aglyn/plugin-manager/plugin-org-erasure'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * The marketplace's share of a workspace erasure: the organization's PUBLIC
 * marketplace identity — its publisher profile and every handle it reserved
 * (AGL-1970, the marketplace's own eraser since AGL-3080).
 *
 * Both survive the erasure's own deletes, and both are `allow read: if true`
 * (`cloud/firebase-firestore.rules`, `match /publisherProfiles/{orgId}`).
 * `publisherProfiles` is keyed by the org id **as the document id**, so no
 * field-keyed sweep sees it.
 *
 * What survived is not cosmetic. `stripeAccountId` is a **payout
 * destination** — written server-side only after Connect onboarding/KYC and
 * trusted by every checkout path — so an erased org would stay world-readable
 * with a live payment-account identifier attached to a dead identity. That is
 * why this eraser is REQUIRED (`"requiredOrgEraser": true`): an erasure
 * refuses to run without it and fails if it throws, rather than recording its
 * share as undone and reporting the workspace erased.
 *
 * `publisherHandles` goes unconditionally: it carries `orgId` as a FIELD and
 * is a **live reservation** — `claimPublisherHandle` refuses a handle another
 * org's row names, so a ghost would hold a marketplace name against a real
 * customer. Rename tombstones (`{ orgId, movedTo }`) carry the same `orgId`
 * and go with it, and the field bound is what makes that safe: re-claiming a
 * tombstone FULL-REPLACES it with the new owner's `{ orgId }`, so a handle
 * this org renamed away from and somebody else has since taken does not match.
 *
 * **The profile is the half with a genuine tension.** `marketplaceListings`
 * outlives an erasure — an erased org's listing is something buyers paid
 * for — so deleting the publisher document outright can leave a listing
 * attributed to nothing. So:
 *
 *   - **No surviving listing** → `recursiveDelete` the profile (it keeps its
 *     daily publish-rate window at `publisherProfiles/{orgId}/meta/publishWindow`,
 *     which a document delete would orphan).
 *   - **A listing survives** → the same `recursiveDelete`, then a minimal
 *     `{ erased: true, erasedAt }` in its place: no handle, no display name,
 *     no bio, no agreement and — the point — no `stripeAccountId`. With no
 *     `handle`, `resolvePublisherProfile` returns `null`, the existing "this
 *     org has no profile" path.
 *
 * The count of surviving listings is reported either way, so an erasure that
 * left something standing says so in its audit row. A plan counts and writes
 * nothing.
 */
export function createPublisherIdentityEraser(
  firestore: () => FirebaseFirestore.Firestore = () => firebaseAdmin.app().firestore(),
): PluginOrgEraser {
  return async ({ orgId, dryRun }): Promise<PluginOrgErasureReport> => {
    const db = firestore()
    const [handles, profileSnapshot, listings] = await Promise.all([
      db.collection('publisherHandles').where('orgId', '==', orgId).get(),
      db.collection('publisherProfiles').doc(orgId).get(),
      // `profileId` is the listing's publishing-org id (AGL-652) — the same
      // value as the profile's document id, under the older field name.
      db.collection('marketplaceListings').where('profileId', '==', orgId).get(),
    ])
    const listingsRetained = listings.size
    const absent = !profileSnapshot.exists
    const report = {
      publisherHandles: handles.size,
      publisherProfileDeleted: !absent && !listingsRetained,
      publisherProfileTombstoned: !absent && listingsRetained > 0,
      listingsRetained,
    }
    if (dryRun) return report
    for (let index = 0; index < handles.docs.length; index += 400) {
      const batch = db.batch()
      for (const doc of handles.docs.slice(index, index + 400)) batch.delete(doc.ref)
      await batch.commit()
    }
    if (absent) return report
    await db.recursiveDelete(profileSnapshot.ref)
    if (listingsRetained) {
      await profileSnapshot.ref.set({ erased: true, erasedAt: FieldValue.serverTimestamp() })
    }
    return report
  }
}
