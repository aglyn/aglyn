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

import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'

/**
 * `sellerPaymentAccount` for specs, read through whatever stand-in the spec
 * gave `@aglyn/tenant-data-admin` (its fake Firestore and `getOrgForHost`),
 * the way the real one reads the Admin SDK. A spec mocks the
 * `server/seller-payment-account` module of the tenant data library with a
 * factory that returns `jest.requireActual` of this file.
 */
export async function sellerPaymentAccount(
  hostId: string,
  org?: Record<string, any> | null,
): Promise<{
  accountId: string
  chargeModel: 'direct' | 'destination'
  chargesEnabled: unknown
  accountLivemode: unknown
} | null> {
  const owner =
    org !== undefined
      ? org
      : (((await getOrgForHost(hostId))?.org as Record<string, any> | undefined) ?? null)
  const ownerUid = String(owner?.['ownerUid'] ?? '')
  if (!ownerUid) return null
  const profile = await firebaseAdmin.app().firestore().collection('profiles').doc(ownerUid).get()
  const accountId = String(profile.get('stripeAccountId') ?? '').trim()
  if (!accountId) return null
  return {
    accountId,
    chargeModel: profile.get('stripeChargeModel') === 'direct' ? 'direct' : 'destination',
    chargesEnabled: profile.get('stripeChargesEnabled'),
    accountLivemode: profile.get('stripeAccountLivemode'),
  }
}
