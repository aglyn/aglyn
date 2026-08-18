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
 *
 * @jest-environment node
 */

/**
 * The publisher half of the `account.updated` subscription (AGL-1997).
 *
 * The seller panel reads `stripeChargesEnabled` / `stripePayoutsEnabled` off
 * `publisherProfiles`, and nothing but the publisher reopening the connect
 * route ever refreshed either. Deliberately a twin of the commerce spec: the
 * whole point of AGL-1994 was that a fix landing on one of these two routes
 * and not the other is invisible.
 */

const syncConnectAccountStatus = jest.fn(async () => 1)
const purchaseSet = jest.fn(async () => undefined)

jest.mock('@aglyn/tenant-data-admin', () => ({
  syncConnectAccountStatus: (...args: unknown[]) =>
    syncConnectAccountStatus(...(args as [])),
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            set: (...args: unknown[]) => purchaseSet(...(args as [])),
            get: async () => ({ exists: false, get: () => undefined }),
          }),
        }),
      }),
    }),
    firestore: { FieldValue: { serverTimestamp: () => 'NOW' } },
  },
  sendGa4Purchase: async () => undefined,
  sendGa4Refund: async () => undefined,
}))

import { marketplaceBillingWebhookHandler } from './billing-webhook'

beforeEach(() => {
  syncConnectAccountStatus.mockClear()
  purchaseSet.mockClear()
})

describe('marketplace webhook: account.updated (AGL-1997)', () => {
  it('syncs the publisher profile when Stripe reports an account change', async () => {
    const account = {
      id: 'acct_pub',
      charges_enabled: true,
      payouts_enabled: false,
    }
    await marketplaceBillingWebhookHandler({
      type: 'account.updated',
      object: account,
      event: {},
    })
    expect(syncConnectAccountStatus).toHaveBeenCalledTimes(1)
    // `publisherProfiles`, not `profiles` — the marketplace binds the account
    // to the publishing ORG (AGL-652), not to a uid.
    expect(syncConnectAccountStatus).toHaveBeenCalledWith(
      'publisherProfiles',
      account,
    )
  })

  // Positive control: a purchase is still processed as a purchase, so the
  // branch above cannot be swallowing the event stream.
  it('leaves a completed purchase to the purchase section', async () => {
    await marketplaceBillingWebhookHandler({
      type: 'checkout.session.completed',
      object: {
        id: 'cs_pub',
        payment_status: 'paid',
        amount_total: 1000,
        metadata: {
          type: 'marketplace-purchase',
          listingId: 'listing-1',
          buyerUid: 'buyer-1',
          sellerOrgId: 'seller-org',
          transferCents: '800',
          feeCents: '200',
        },
      },
      event: {},
    })
    expect(syncConnectAccountStatus).not.toHaveBeenCalled()
    expect(purchaseSet).toHaveBeenCalled()
  })
})
