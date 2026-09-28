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

/*==========================================
 * A LOCKED PUBLISHER, ON THE MARKETPLACE (AGL-3365).
 *
 * Two parts of a workspace lock reach into the marketplace, through the
 * core seams in `plugin-org-lockdown.ts`:
 *
 * 1. THE PUBLISHER'S PAYOUT ACCOUNT. `publisherProfiles/{orgId}` holds the
 *    connected account marketplace sales pay out through, separate from the
 *    storefront account core already knows. Declared as a payout-account
 *    source, so a lock that pauses payouts pauses it too, and saves and
 *    restores its schedule on its own record.
 *
 * 2. THE LISTINGS. A locked workspace's listings leave browse, search and
 *    their pages, whatever the lock's reason. Browse is a client query over
 *    a field the server derives (`browseAudience`), and a client cannot read
 *    another workspace's lock, so a read-time check would cost a lock read
 *    per card. Instead the lock stamps `workspaceLockedAt` on the
 *    workspace's listings, `isListingBrowsable` refuses a stamped one, and
 *    the lift removes exactly the stamps. The flag sits BESIDE every
 *    visibility field rather than overwriting one, so a listing the
 *    publisher had unpublished, made private, or that staff took down is
 *    still exactly that after the lift. Nothing is published by a lift.
 *=========================================*/

import {
  registerOrgLockdownParticipant,
  registerPayoutAccountSource,
} from '@aglyn/aglyn/plugin-manager/plugin-org-lockdown'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { BUNDLE_ID } from '../constants/bundle-common'
import { refreshListingQueryFields } from './listing-query-fields'

/** How many of one workspace's listings a lock stamps. */
const MAX_LISTINGS = 1000

/** The publisher's own connected account, if it has one. */
export async function publisherPayoutAccounts(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<Array<{ accountId: string; label: string }>> {
  if (!orgId) return []
  const accountId = String(
    (await firestore.collection('publisherProfiles').doc(orgId).get()).get('stripeAccountId') ?? '',
  )
  return accountId ? [{ accountId, label: 'marketplace publisher' }] : []
}

/**
 * Stamp (lock) or clear (lift) `workspaceLockedAt` on the workspace's
 * listings, and re-derive what browse queries by. Only the stamp moves: a
 * lift clears it from the listings that carry it and touches nothing else.
 */
export async function setPublisherListingsLocked(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  locked: boolean,
): Promise<{ changed: number; total: number; truncated: boolean }> {
  const snapshot = await firestore
    .collection('marketplaceListings')
    .where('profileId', '==', orgId)
    .limit(MAX_LISTINGS + 1)
    .get()
  const docs = snapshot.docs.slice(0, MAX_LISTINGS)
  let changed = 0
  for (const doc of docs) {
    const stamped = Boolean(doc.get('workspaceLockedAt'))
    if (stamped === locked) continue
    await doc.ref.set(
      {
        workspaceLockedAt: locked
          ? firebaseAdmin.firestore.FieldValue.serverTimestamp()
          : firebaseAdmin.firestore.FieldValue.delete(),
      },
      { merge: true },
    )
    await refreshListingQueryFields(doc.ref)
    changed += 1
  }
  return { changed, total: docs.length, truncated: snapshot.docs.length > MAX_LISTINGS }
}

/** Declares the marketplace's part in a workspace lock. */
export function registerMarketplaceLockdown(): void {
  registerPayoutAccountSource(
    {
      listPayoutAccounts: ({ orgId }) =>
        publisherPayoutAccounts(firebaseAdmin.app().firestore(), orgId),
    },
    { pluginId: BUNDLE_ID },
  )
  registerOrgLockdownParticipant(
    {
      onOrgLockChange: async ({ orgId, locked }) => {
        const result = await setPublisherListingsLocked(
          firebaseAdmin.app().firestore(),
          orgId,
          locked,
        )
        return {
          summary:
            `${locked ? 'Hid' : 'Restored'} ${result.changed} marketplace listing(s) ` +
            `of ${result.total}` +
            (result.truncated ? '; more exist and were not reached' : ''),
          confirmed: !result.truncated,
        }
      },
    },
    { pluginId: BUNDLE_ID },
  )
}
