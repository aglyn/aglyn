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
 * A FACILITATED SALE RECORDS WHICH STATE IT WAS TAXED IN (AGL-2137).
 *
 * Aglyn is a marketplace facilitator, so the tax on a marketplace purchase is
 * Aglyn's to collect and to remit — and a return reports it BY STATE. Every
 * input for that already existed: checkout requires a billing address, enables
 * `automatic_tax`, and Stripe computes the tax from the address it collected
 * and states that address back on the session. Nothing stored it, so every
 * facilitated sale reached the return with no jurisdiction at all.
 *
 * THE WRITE HALF. The reader is `apps/console/utils/server/tx-return.ts`, and
 * its counts are asserted by `apps/console/specs/marketplace-tax-jurisdiction`
 * — a separate suite because a `scope:app` project may not import this lib.
 * That spec pins the field NAME against this file's source for the same
 * reason: a webhook storing under one name and a return reading another are
 * each internally consistent and would each pass their own suite.
 */

const mockWrites: Array<{ path: string; data: Record<string, unknown> }> = []
const mockStore: Record<string, Record<string, unknown> | undefined> = {}

jest.mock('next/server', () => ({
  // The handler schedules its GA beacon through `after`, which throws outside
  // a request scope. Run it inline — nothing here asserts on GA.
  after: (work: () => unknown) => {
    void work()
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const docFor = (path: string) => ({
    id: path.split('/').pop() ?? path,
    set: (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      mockWrites.push({ path, data })
      mockStore[path] = options?.merge
        ? { ...(mockStore[path] ?? {}), ...data }
        : data
      return Promise.resolve()
    },
    get: async () => ({
      exists: Boolean(mockStore[path]),
      data: () => mockStore[path],
      get: (field: string) => (mockStore[path] ?? {})[field],
    }),
    delete: () => {
      delete mockStore[path]
      return Promise.resolve()
    },
  })
  return {
    sendGa4Purchase: async () => ({ sent: true, synthesizedClientId: false }),
    sendGa4Refund: async () => ({ sent: true, synthesizedClientId: false }),
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collection: (name: string) => ({
            doc: (id: string) => docFor(`${name}/${id}`),
            where: () => ({
              limit: () => ({ get: async () => ({ empty: true, docs: [] }) }),
            }),
          }),
        }),
      }),
      firestore: {
        FieldValue: { serverTimestamp: () => new Date('2026-08-14T00:00:00Z') },
      },
    },
  }
})

import { marketplaceBillingWebhookHandler } from './billing-webhook'

const PURCHASE = 'marketplacePurchases/cs_test_jurisdiction'

/**
 * A paid marketplace checkout session, as Stripe delivers it.
 *
 * The address carries `city`, `postal_code` and `line1` on purpose: Stripe
 * hands the webhook a full billing address, and the assertions below pin that
 * only the two fields a return groups by are kept out of it.
 */
const completedSession = (over: Record<string, unknown> = {}) => ({
  type: 'checkout.session.completed',
  object: {
    id: 'cs_test_jurisdiction',
    payment_status: 'paid',
    payment_intent: 'pi_jurisdiction',
    amount_total: 10825,
    total_details: { amount_tax: 825 },
    customer_details: {
      address: {
        country: 'US',
        state: 'TX',
        city: 'Austin',
        postal_code: '78701',
        line1: '100 Congress Ave',
      },
    },
    metadata: {
      type: 'marketplace-purchase',
      listingId: 'listing-1',
      buyerUid: 'buyer-1',
      buyerOrgId: 'buyer-org',
      sellerOrgId: 'seller-org',
      feeCents: '2000',
      transferCents: '8000',
    },
    ...over,
  },
  event: {},
})

beforeEach(() => {
  mockWrites.length = 0
  for (const key of Object.keys(mockStore)) delete mockStore[key]
})

describe('the purchase records the jurisdiction its tax was computed for', () => {
  it('stores the buyer’s country and state from the session Stripe taxed', async () => {
    await marketplaceBillingWebhookHandler(completedSession() as any)

    expect(mockStore[PURCHASE]?.customerAddress).toEqual({
      country: 'US',
      state: 'TX',
    })
  })

  it('stores ONLY the two fields the return groups by', async () => {
    await marketplaceBillingWebhookHandler(completedSession() as any)

    // Data minimisation, pinned. Stripe hands over a street address and this
    // document already names `buyerUid`, so every extra field is personal
    // data kept on a tax record for no filing purpose. The return keys every
    // jurisdiction `COUNTRY-STATE` and reads nothing finer, on this
    // collection or on either of its two siblings.
    expect(
      Object.keys(mockStore[PURCHASE]?.customerAddress as object).sort(),
    ).toEqual(['country', 'state'])
  })

  it('records a country with no state — not every country has one', async () => {
    await marketplaceBillingWebhookHandler(
      completedSession({
        customer_details: { address: { country: 'FR', postal_code: '75001' } },
      }) as any,
    )

    expect(mockStore[PURCHASE]?.customerAddress).toEqual({
      country: 'FR',
      state: null,
    })
  })

  it('records NO address at all when the session states no country', async () => {
    await marketplaceBillingWebhookHandler(
      completedSession({ customer_details: {} }) as any,
    )

    // Absent, not `{ country: null }`: a row that states no jurisdiction has
    // to READ as missing to the return, and an empty shell reads as stated.
    expect(mockStore[PURCHASE]).toBeTruthy()
    expect(mockStore[PURCHASE]?.customerAddress).toBeUndefined()
  })

  it('leaves the money split and the entitlement exactly as they were', async () => {
    await marketplaceBillingWebhookHandler(completedSession() as any)

    // The jurisdiction is a recording change and nothing else: what the buyer
    // was charged, what the publisher was transferred and what the platform
    // kept are Stripe's numbers and stay untouched.
    expect(mockStore[PURCHASE]).toMatchObject({
      listingId: 'listing-1',
      buyerUid: 'buyer-1',
      buyerOrgId: 'buyer-org',
      sellerOrgId: 'seller-org',
      amountCents: 10825,
      feeCents: 2000,
      taxCents: 825,
      transferCents: 8000,
      paymentIntentId: 'pi_jurisdiction',
    })
  })
})

describe('THE CONTROL — an unattributed sale is never given a jurisdiction', () => {
  /**
   * The purchases already in `marketplacePurchases` carry no address. The
   * address they were taxed from is still in Stripe and this codebase can
   * reach it, which is exactly why the rule has to be written down as a test:
   * copying it back would attribute a period that was already reported
   * without it, and a jurisdiction reconstructed after the fact is a guess
   * presented to a tax authority as a fact.
   *
   * Forced red on purpose by hoisting the `customerAddress` spread out of the
   * first-record branch in `billing-webhook.ts`, which is precisely what
   * turns a redelivery into a backfill: the stored address then comes back
   * `{ country: 'US', state: 'TX' }` on a row that had none.
   */
  it('a session REDELIVERY does not stamp a jurisdiction onto an existing row', async () => {
    // The document as it stands today: recorded before the webhook stored a
    // jurisdiction, and inside a period that may already have been filed.
    mockStore[PURCHASE] = {
      listingId: 'listing-1',
      buyerUid: 'buyer-1',
      sellerOrgId: 'seller-org',
      amountCents: 10825,
      taxCents: 825,
      transferCents: 8000,
      createdAt: new Date('2026-07-15T00:00:00Z'),
    }

    // Stripe redelivers `checkout.session.completed` for up to three days
    // after any 500, and the redelivered object carries the buyer's address.
    await marketplaceBillingWebhookHandler(completedSession() as any)

    expect(mockStore[PURCHASE]?.customerAddress).toBeUndefined()
    // And the redelivery is still harmless in every other respect — the
    // reason the write merges in the first place.
    expect(mockStore[PURCHASE]?.createdAt).toEqual(
      new Date('2026-07-15T00:00:00Z'),
    )
  })

  it('a redelivery does not CHANGE a jurisdiction already recorded', async () => {
    await marketplaceBillingWebhookHandler(completedSession() as any)
    // A redelivery whose address somehow differs must not move the sale to
    // another state: the jurisdiction the tax was computed under is the one
    // the sale was recorded with, and only that one is defensible.
    await marketplaceBillingWebhookHandler(
      completedSession({
        customer_details: { address: { country: 'US', state: 'CA' } },
      }) as any,
    )

    expect(mockStore[PURCHASE]?.customerAddress).toEqual({
      country: 'US',
      state: 'TX',
    })
  })
})
