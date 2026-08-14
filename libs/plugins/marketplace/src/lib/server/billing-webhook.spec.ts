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
 * The marketplace section of the platform Stripe webhook (AGL-46/418,
 * extended by AGL-1544/1546): the purchase doc is the buyer's entitlement
 * AND the seller ledger AND the tax record, so what lands on it is a
 * contract, not an implementation detail.
 */

jest.mock('@aglyn/tenant-data-admin', () => {
  const writes: Array<{ path: string; data: Record<string, unknown> }> = []
  const store: Record<string, Record<string, unknown> | undefined> = {}
  const docFor = (path: string) => ({
    set: (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      writes.push({ path, data })
      store[path] = options?.merge
        ? { ...(store[path] ?? {}), ...data }
        : data
      return Promise.resolve()
    },
    get: async () => ({
      exists: Boolean(store[path]),
      data: () => store[path],
      get: (field: string) => (store[path] ?? {})[field],
    }),
  })
  return {
    __writes: writes,
    __store: store,
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collection: (name: string) => ({
            doc: (id: string) => docFor(`${name}/${id}`),
            where: (field: string, _op: string, value: unknown) => ({
              limit: () => ({
                get: async () => {
                  const docs = Object.entries(store)
                    .filter(
                      ([path, data]) =>
                        path.startsWith(`${name}/`) &&
                        (data ?? {})[field] === value,
                    )
                    .map(([path, data]) => ({
                      ref: docFor(path),
                      get: (f: string) => (data ?? {})[f],
                      data: () => data,
                    }))
                  return { empty: docs.length === 0, docs }
                },
              }),
            }),
          }),
        }),
      }),
      firestore: { FieldValue: { serverTimestamp: () => 'NOW' } },
    },
  }
})

import { marketplaceBillingWebhookHandler } from './billing-webhook'

const adminMock = jest.requireMock('@aglyn/tenant-data-admin') as {
  __writes: Array<{ path: string; data: Record<string, unknown> }>
  __store: Record<string, Record<string, unknown> | undefined>
}

const completedSession = (over: Record<string, unknown> = {}) => ({
  type: 'checkout.session.completed',
  object: {
    id: 'cs_test_1',
    payment_status: 'paid',
    payment_intent: 'pi_1',
    amount_total: 10825,
    total_details: { amount_tax: 825 },
    metadata: {
      type: 'marketplace-purchase',
      listingId: 'listing-1',
      buyerUid: 'buyer-1',
      sellerOrgId: 'seller-org',
      feeCents: '2000',
      transferCents: '8000',
    },
    ...over,
  },
  event: {},
})

beforeEach(() => {
  adminMock.__writes.length = 0
  for (const key of Object.keys(adminMock.__store)) {
    delete adminMock.__store[key]
  }
})

describe('marketplace purchase record (AGL-46/1544)', () => {
  it('writes the purchase keyed by session id with the full money split', async () => {
    await marketplaceBillingWebhookHandler(completedSession() as any)
    expect(adminMock.__writes).toHaveLength(1)
    const { path, data } = adminMock.__writes[0]
    expect(path).toBe('marketplacePurchases/cs_test_1')
    expect(data).toMatchObject({
      listingId: 'listing-1',
      buyerUid: 'buyer-1',
      sellerOrgId: 'seller-org',
      amountCents: 10825,
      feeCents: 2000,
      // The tax the PLATFORM owes and the transfer the SELLER received —
      // without these the ledger cannot show a remittance-correct split.
      taxCents: 825,
      transferCents: 8000,
      paymentIntentId: 'pi_1',
    })
  })

  it('ignores unpaid sessions and foreign metadata', async () => {
    await marketplaceBillingWebhookHandler(
      completedSession({ payment_status: 'unpaid' }) as any,
    )
    await marketplaceBillingWebhookHandler(
      completedSession({ metadata: { type: 'subscription' } }) as any,
    )
    expect(adminMock.__writes).toHaveLength(0)
  })
})
