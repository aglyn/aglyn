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
 * The paid-listing checkout money path (AGL-1543/1544).
 *
 * These drive the REAL entitlement resolvers (jest.requireActual) rather
 * than stubs, because the defects under test were exactly the gap between
 * the raw `plan` field and resolved entitlements: a canceled subscription
 * still reading as pro, and a negotiated per-org rate being impossible.
 * The Stripe call is captured as the URLSearchParams the handler built —
 * the session request IS the contract this file pins.
 */

jest.mock('./publisher-profile', () => ({
  canActAsPublisher: async () => false,
  resolvePublisherProfile: async () =>
    (jest.requireMock('./publisher-profile') as { __publisher: unknown })
      .__publisher,
  __publisher: undefined as unknown,
}))

jest.mock('@aglyn/aglyn/server', () => {
  // The REAL fee/entitlement logic — the whole point of AGL-1543 is that
  // checkout must agree with it, so stubbing it here would test nothing.
  const entitlements = jest.requireActual(
    '@aglyn/aglyn/app-utils/plan-entitlements',
  )
  return {
    buildRoute: (_route: string, params: Record<string, string>) =>
      `/${params.orgSlug}/marketplace`,
    Route: { ORG_MARKETPLACE: '/manage/marketplace' },
    checkEntitlement: entitlements.checkEntitlement,
    resolveMarketplaceFeePct: entitlements.resolveMarketplaceFeePct,
  }
})

jest.mock('@aglyn/tenant-data-admin', () => {
  const store: Record<string, Record<string, unknown> | undefined> = {}
  const docFor = (path: string) => ({
    get: async () => ({
      exists: Boolean(store[path]),
      data: () => store[path],
      get: (field: string) => (store[path] ?? {})[field],
    }),
  })
  return {
    __store: store,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async () => ({
            uid: 'buyer-1',
            email: 'buyer@example.com',
          }),
        }),
        firestore: () => ({
          collection: (name: string) => ({
            doc: (id: string) => docFor(`${name}/${id}`),
          }),
        }),
      }),
      firestore: { FieldValue: { serverTimestamp: () => 'NOW' } },
    },
  }
})

import { checkoutHandler } from './checkout'

const store = () =>
  (jest.requireMock('@aglyn/tenant-data-admin') as {
    __store: Record<string, Record<string, unknown> | undefined>
  }).__store

const publisherMock = jest.requireMock('./publisher-profile') as {
  __publisher: unknown
}

const stripeCalls: Array<{ url: string; params: URLSearchParams }> = []

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
  }
  return res
}

function makeReq(body: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    headers: {
      authorization: 'Bearer token',
      origin: 'https://console.aglyn.com',
    },
    body: { listingId: 'listing-1', ...body },
  } as any
}

/** Seed the healthy baseline; individual tests override what they break. */
function seed({
  sellerOrg = { plan: 'pro', slug: 'acme' } as Record<string, unknown>,
  listing = {} as Record<string, unknown>,
} = {}) {
  for (const key of Object.keys(store())) delete store()[key]
  store()['marketplaceListings/listing-1'] = {
    priceUsd: 100,
    profileId: 'seller-org',
    displayName: 'Fancy hero',
    reviewStatus: 'listed',
    ...listing,
  }
  store()['orgs/seller-org'] = sellerOrg
  publisherMock.__publisher = {
    orgId: 'seller-org',
    handle: 'acme',
    stripeAccountId: 'acct_seller',
    stripeChargesEnabled: true,
  }
}

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_spec'
})

beforeEach(() => {
  stripeCalls.length = 0
  global.fetch = jest.fn(async (url: unknown, init?: { body?: unknown }) => {
    stripeCalls.push({
      url: String(url),
      params: new URLSearchParams(String(init?.body ?? '')),
    })
    return {
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/c/session' }),
    }
  }) as unknown as typeof fetch
})

describe('marketplace checkout take rate + sale-time gates (AGL-1543)', () => {
  it('prices a healthy pro seller at the 20% platform rate', async () => {
    seed()
    const res = makeRes()
    await checkoutHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    const { params } = stripeCalls[0]
    expect(params.get('line_items[0][price_data][unit_amount]')).toBe('10000')
    expect(params.get('metadata[feeCents]')).toBe('2000')
  })

  it('honors a negotiated per-org fee override from entitlements', async () => {
    seed({
      sellerOrg: {
        plan: 'pro',
        slug: 'acme',
        entitlements: { marketplaceFeePct: 15 },
      },
    })
    const res = makeRes()
    await checkoutHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(stripeCalls[0].params.get('metadata[feeCents]')).toBe('1500')
  })

  it('prices a free-plan seller (selling granted by override) at 30%', async () => {
    seed({
      sellerOrg: {
        plan: 'free',
        slug: 'acme',
        entitlements: { features: { marketplaceSelling: true } },
      },
    })
    const res = makeRes()
    await checkoutHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(stripeCalls[0].params.get('metadata[feeCents]')).toBe('3000')
  })

  it('refuses to sell for a publisher whose subscription is dead', async () => {
    // The stale `plan: 'pro'` field still says pro; the ENTITLEMENT says
    // this org is effectively free and free cannot sell. Before AGL-1543
    // this sold at the 20% paid rate.
    seed({
      sellerOrg: { plan: 'pro', slug: 'acme', billingStatus: 'canceled' },
    })
    const res = makeRes()
    await checkoutHandler(makeReq(), res)
    expect(res.statusCode).toBe(409)
    expect(stripeCalls).toHaveLength(0)
  })

  it('404s a listing review has not listed — the paid path is not a side door', async () => {
    for (const reviewStatus of ['rejected', 'submitted', 'in_review']) {
      seed({ listing: { reviewStatus } })
      const res = makeRes()
      await checkoutHandler(makeReq(), res)
      expect(`${reviewStatus} → ${res.statusCode}`).toBe(`${reviewStatus} → 404`)
    }
    expect(stripeCalls).toHaveLength(0)
  })

  it('still sells a legacy listing with no reviewStatus at all', async () => {
    seed({ listing: { reviewStatus: undefined } })
    const res = makeRes()
    await checkoutHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
  })

  it('collects tax on the platform side — the marketplace-provider position (AGL-1544)', async () => {
    seed()
    const res = makeRes()
    await checkoutHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    const { params } = stripeCalls[0]
    expect(params.get('automatic_tax[enabled]')).toBe('true')
    // Tax is added ON TOP of the listing price, never carved out of the
    // seller's share.
    expect(params.get('line_items[0][price_data][tax_behavior]')).toBe(
      'exclusive',
    )
    // Tax needs a situs; 'auto' can settle for less than a full address.
    expect(params.get('billing_address_collection')).toBe('required')
    // No on_behalf_of: Aglyn stays merchant of record, which IS the
    // marketplace-provider posture registered with the Texas Comptroller.
    expect(params.get('payment_intent_data[on_behalf_of]')).toBeNull()
  })

  it('transfers the seller exactly their pre-tax share — tax stays on the platform (AGL-1544)', async () => {
    seed()
    const res = makeRes()
    await checkoutHandler(makeReq(), res)
    const { params } = stripeCalls[0]
    // application_fee_amount would make Stripe transfer amount_total − fee,
    // and amount_total INCLUDES the tax — handing Aglyn's remittance
    // liability to the seller. A fixed transfer amount is immune to what
    // automatic tax adds on top.
    expect(params.get('payment_intent_data[application_fee_amount]')).toBeNull()
    expect(params.get('payment_intent_data[transfer_data][destination]')).toBe(
      'acct_seller',
    )
    expect(params.get('payment_intent_data[transfer_data][amount]')).toBe(
      '8000',
    )
    expect(params.get('metadata[transferCents]')).toBe('8000')
    expect(params.get('metadata[feeCents]')).toBe('2000')
  })

  it('409s when the publisher has not finished Stripe onboarding', async () => {
    seed()
    publisherMock.__publisher = {
      orgId: 'seller-org',
      handle: 'acme',
      stripeAccountId: 'acct_seller',
      stripeChargesEnabled: false,
    }
    const res = makeRes()
    await checkoutHandler(makeReq(), res)
    expect(res.statusCode).toBe(409)
    expect(stripeCalls).toHaveLength(0)
  })
})
