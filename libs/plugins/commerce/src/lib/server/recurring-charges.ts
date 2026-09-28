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
 * THE MEMBERSHIPS A SITE SELLS, FOR A SECURITY LOCKDOWN (AGL-3364).
 *
 * A storefront subscription (a membership, a recurring product) is
 * recorded at `hosts/{hostId}/subscriptions/{stripeSubscriptionId}` when
 * the checkout completes, and its `status` follows Stripe's
 * `customer.subscription.*` events (see `billing-webhook.ts`). That record
 * is the answer to "what does this site bill on a schedule": the lockdown
 * asks here and pauses exactly these, rather than searching Stripe.
 *=========================================*/

import {
  type RecurringChargeRecord,
  registerRecurringChargeSource,
} from '@aglyn/aglyn/plugin-manager/plugin-recurring-charges'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { BUNDLE_ID } from '../constants/bundle-common'

/**
 * Stripe statuses that can still produce a charge. `canceled` and
 * `incomplete_expired` never bill again; `paused` (a trial that ended with
 * no payment method) does not bill until a card is added, which the lock's
 * pause would then catch on the next lock anyway.
 */
export const LIVE_SUBSCRIPTION_STATUSES = [
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'incomplete',
] as const

/** A Firestore handle's shape, as far as this reader uses it. */
export interface RecurringChargesFirestore {
  collection(name: string): {
    doc(id: string): {
      collection(name: string): {
        where(field: string, op: 'in', value: readonly string[]): {
          get(): Promise<{ docs: Array<{ id: string }> }>
        }
      }
    }
  }
}

/** Every live subscription the given sites sell. Throws if a read throws. */
export async function listCommerceLiveSubscriptions(
  firestore: RecurringChargesFirestore,
  hostIds: readonly string[],
): Promise<RecurringChargeRecord[]> {
  const found: RecurringChargeRecord[] = []
  for (const hostId of hostIds) {
    if (!hostId) continue
    const snapshot = await firestore
      .collection('hosts')
      .doc(hostId)
      .collection('subscriptions')
      .where('status', 'in', LIVE_SUBSCRIPTION_STATUSES)
      .get()
    for (const doc of snapshot.docs) {
      found.push({ subscriptionId: doc.id, hostId })
    }
  }
  return found
}

/** Declares the storefront's subscriptions to the lockdown. */
export function registerCommerceRecurringCharges(): void {
  registerRecurringChargeSource(
    {
      listLiveSubscriptions: ({ hostIds }) =>
        listCommerceLiveSubscriptions(
          firebaseAdmin.app().firestore() as unknown as RecurringChargesFirestore,
          hostIds,
        ),
    },
    { pluginId: BUNDLE_ID },
  )
}
