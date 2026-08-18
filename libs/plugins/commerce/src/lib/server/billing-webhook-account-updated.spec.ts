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
 * The `account.updated` subscription (AGL-1997).
 *
 * Before it, `stripeChargesEnabled` — the field checkout, cart checkout,
 * draft orders, reservations and POS all gate the sale on — was refreshed
 * only when the merchant reopened the connect route. A merchant Stripe
 * restricted kept a stale `true` and kept selling; the shopper met the
 * failure at payment time.
 *
 * This asserts the WIRING: that the commerce webhook subscribes the event at
 * all, and points it at its own collection. What the sync then writes is
 * pinned by `connect-account-status.spec.ts` in tenant-data-admin.
 */

const syncConnectAccountStatus = jest.fn(async () => 1)
const recordStorefrontTax = jest.fn(async () => undefined)

jest.mock('./storefront-tax-record', () => ({
  recordStorefrontTax: (...args: unknown[]) =>
    recordStorefrontTax(...(args as [])),
  SESSION_TYPES: [],
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  syncConnectAccountStatus: (...args: unknown[]) =>
    syncConnectAccountStatus(...(args as [])),
  firebaseAdmin: {
    app: () => ({
      firestore: () => {
        throw new Error('the account.updated branch must not reach Firestore')
      },
    }),
    firestore: { FieldValue: { serverTimestamp: () => 'NOW' } },
  },
  findUserByUidAcrossPools: async () => null,
  getOrgForHost: async () => null,
  meterHostEmail: async () => undefined,
  notifyHostManagers: async () => undefined,
  upsertHostContact: async () => undefined,
  renderHostEmailWithTokens: (value: string) => value,
  updateExisting: async () => true,
}))

import { commerceBillingWebhookHandler } from './billing-webhook'

beforeEach(() => {
  syncConnectAccountStatus.mockClear()
  recordStorefrontTax.mockClear()
})

describe('commerce webhook: account.updated (AGL-1997)', () => {
  it('syncs the merchant profile when Stripe reports an account change', async () => {
    const account = {
      id: 'acct_1',
      charges_enabled: false,
      payouts_enabled: false,
    }
    await commerceBillingWebhookHandler({
      type: 'account.updated',
      object: account,
      event: { type: 'account.updated', data: { object: account } },
    })
    expect(syncConnectAccountStatus).toHaveBeenCalledTimes(1)
    // `profiles` is where the commerce connect route binds the account —
    // pointing this at the publisher collection would sync nothing and fail
    // silently, which is the shape of the bug it fixes.
    expect(syncConnectAccountStatus).toHaveBeenCalledWith('profiles', account)
  })

  // Positive control on the early return: an account event is not an order,
  // and must not fall through the sections below it.
  it('does not record an account event as a storefront tax row', async () => {
    await commerceBillingWebhookHandler({
      type: 'account.updated',
      object: { id: 'acct_1', charges_enabled: true, payouts_enabled: true },
      event: {},
    })
    expect(recordStorefrontTax).not.toHaveBeenCalled()
  })

  // Positive control the other way: the branch must be selective. If it ran
  // for every event, a checkout would stop being processed as a checkout.
  it('leaves every other event to the sections below', async () => {
    await commerceBillingWebhookHandler({
      type: 'checkout.session.completed',
      object: { id: 'cs_1', metadata: {} },
      event: {},
    })
    expect(syncConnectAccountStatus).not.toHaveBeenCalled()
    expect(recordStorefrontTax).toHaveBeenCalledTimes(1)
  })
})
