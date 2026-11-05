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
 * What a marketplace sale decides before Stripe (AGL-4049): every refusal, in
 * the order the doors have always answered them, and the waiver rule that
 * holds for the platform's own org at 0% and for nobody else.
 *
 * The entitlement and fee logic are the REAL resolvers, for the reason
 * `checkout.spec.ts` gives: a stub here would be this file agreeing with itself.
 */

jest.mock('@aglyn/aglyn/server', () => {
  const entitlements = jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements')
  return {
    checkEntitlement: entitlements.checkEntitlement,
    resolveMarketplaceFeePct: entitlements.resolveMarketplaceFeePct,
    isListingWideRevocation: jest.requireActual('@aglyn/aglyn/app-utils/plugin-manifest')
      .isListingWideRevocation,
  }
})

const mockPublisher: { current: Record<string, unknown> | null } = { current: null }
const mockSellerMember = { current: false }
jest.mock('./publisher-profile', () => ({
  isPublisherMember: async () => mockSellerMember.current,
  resolvePublisherProfile: async () => mockPublisher.current,
}))

const mockOwned = { current: false }
jest.mock('./purchase-entitlement', () => ({
  hasLivePurchase: async () => mockOwned.current,
}))

import { resolveSale, type SaleBuyer, type SaleRefusal } from './sale'

const docs: Record<string, Record<string, unknown> | undefined> = {}

const firestore = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      get: async () => ({
        exists: Boolean(docs[`${name}/${id}`]),
        data: () => docs[`${name}/${id}`],
      }),
    }),
  }),
} as unknown as FirebaseFirestore.Firestore

const BUYER: SaleBuyer = {
  uid: 'buyer-1',
  orgId: 'buyer-org',
  permissions: { createHosts: true, installPlugins: true },
}

const READY_PUBLISHER = {
  orgId: 'seller-org',
  handle: 'acme',
  stripeAccountId: 'acct_seller',
  stripeChargesEnabled: true,
}

function seed(
  listing: Record<string, unknown> = {},
  sellerOrg: Record<string, unknown> = { plan: 'pro', slug: 'acme' },
) {
  for (const key of Object.keys(docs)) delete docs[key]
  docs['marketplaceListings/listing-1'] = {
    priceUsd: 100,
    profileId: 'seller-org',
    displayName: 'Fancy hero',
    reviewStatus: 'listed',
    ...listing,
  }
  docs['orgs/seller-org'] = sellerOrg
}

const sale = (buyer: SaleBuyer = BUYER) =>
  resolveSale({ firestore, listingId: 'listing-1', buyer })

async function refusalOf(buyer?: SaleBuyer): Promise<SaleRefusal> {
  const outcome = await sale(buyer)
  if (!('refusal' in outcome)) throw new Error('expected a refusal')
  return outcome.refusal
}

async function saleOf(buyer?: SaleBuyer) {
  const outcome = await sale(buyer)
  if (!('sale' in outcome)) throw new Error(`refused: ${JSON.stringify(outcome.refusal)}`)
  return outcome.sale
}

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_spec'
})

beforeEach(() => {
  delete process.env.AGLYN_PLATFORM_ORG_ID
  mockPublisher.current = READY_PUBLISHER
  mockOwned.current = false
  mockSellerMember.current = false
  seed()
})

describe('a healthy sale', () => {
  it('prices the split from the seller org and names its account', async () => {
    expect(await saleOf()).toMatchObject({
      sellerOrgId: 'seller-org',
      siteStarter: false,
      feePercent: 20,
      amountCents: 10000,
      feeCents: 2000,
      transferCents: 8000,
      accountId: 'acct_seller',
      platformSale: false,
    })
  })

  it('rounds a price the way the fee has always rounded', async () => {
    seed({ priceUsd: 9.99 })
    expect(await saleOf()).toMatchObject({ amountCents: 999, feeCents: 200, transferCents: 799 })
  })
})

describe('every refusal', () => {
  it('an unknown or deleted listing is a 404', async () => {
    delete docs['marketplaceListings/listing-1']
    expect((await refusalOf()).status).toBe(404)
    seed({ deletedAt: 'then' })
    expect((await refusalOf()).status).toBe(404)
  })

  it('a site starter asks for hosts.create, naming it', async () => {
    seed({ artifactType: 'siteStarter' })
    const refusal = await refusalOf({ ...BUYER, permissions: { installPlugins: true } })
    expect(refusal.status).toBe(403)
    expect(String(refusal.body['error'])).toContain('Create sites')
  })

  it('everything else asks for plugins.install', async () => {
    const refusal = await refusalOf({ ...BUYER, permissions: { createHosts: true } })
    expect(refusal.status).toBe(403)
  })

  it.each([
    ['rejected', { reviewStatus: 'rejected' }],
    ['in review', { reviewStatus: 'in_review' }],
    ['taken down', { hiddenAt: 'then', reviewStatus: 'listed' }],
    ['private', { visibility: 'private' }],
  ])('a %s listing reads as unknown, never as a reason', async (_name, listing) => {
    seed(listing)
    expect(await refusalOf()).toEqual({ status: 404, body: { error: 'Unknown listing' } })
  })

  it('a free listing is not sold', async () => {
    seed({ priceUsd: 0 })
    expect((await refusalOf()).status).toBe(400)
  })

  it('the seller cannot buy from itself, by org or by being a member in any role', async () => {
    expect((await refusalOf({ ...BUYER, orgId: 'seller-org' })).status).toBe(400)
    mockSellerMember.current = true
    expect((await refusalOf()).status).toBe(400)
  })

  it('a workspace that owns it is told so', async () => {
    mockOwned.current = true
    const refusal = await refusalOf()
    expect(refusal.status).toBe(409)
    expect(refusal.body['code']).toBe('already_purchased')
  })

  it('a listing-wide revocation stops the sale, a per-version one does not', async () => {
    docs['revocations/listing-1'] = { versions: 'all', reason: 'malware', revokedAt: 'then' }
    expect((await refusalOf()).status).toBe(404)
    docs['revocations/listing-1'] = { versions: ['1.0.0'], reason: 'bug', revokedAt: 'then' }
    expect(await saleOf()).toMatchObject({ amountCents: 10000 })
  })

  it('a seller with no ready payout account cannot be sold from', async () => {
    mockPublisher.current = { ...READY_PUBLISHER, stripeChargesEnabled: false }
    expect((await refusalOf()).status).toBe(409)
    mockPublisher.current = null
    expect((await refusalOf()).status).toBe(409)
  })

  it('a locked seller reads as an unknown listing', async () => {
    seed({}, { plan: 'pro', suspendedAt: 'then' })
    expect(await refusalOf()).toEqual({ status: 404, body: { error: 'Unknown listing' } })
  })

  it('a plan without marketplace selling cannot sell', async () => {
    seed({}, { plan: 'pro', billingStatus: 'canceled' })
    expect((await refusalOf()).status).toBe(409)
  })
})

describe('the waiver rule (AGL-4049 decision 8)', () => {
  const WAIVED = {
    plan: 'pro',
    slug: 'aglyn',
    entitlements: { marketplaceFeePct: 0 },
  }

  it('the platform org at 0% sells with no transfer and no payout account', async () => {
    process.env.AGLYN_PLATFORM_ORG_ID = 'seller-org'
    seed({}, WAIVED)
    mockPublisher.current = { orgId: 'seller-org', handle: 'aglyn' }
    expect(await saleOf()).toMatchObject({
      platformSale: true,
      feePercent: 0,
      feeCents: 0,
      transferCents: 0,
      amountCents: 10000,
    })
  })

  it('the marker is read trimmed', async () => {
    process.env.AGLYN_PLATFORM_ORG_ID = '  seller-org\n'
    seed({}, WAIVED)
    mockPublisher.current = { orgId: 'seller-org', handle: 'aglyn' }
    expect((await saleOf()).platformSale).toBe(true)
  })

  it('every other refusal still holds for it', async () => {
    process.env.AGLYN_PLATFORM_ORG_ID = 'seller-org'
    seed({}, { ...WAIVED, suspendedAt: 'then' })
    expect((await refusalOf()).status).toBe(404)
    seed({ priceUsd: 0 }, WAIVED)
    expect((await refusalOf()).status).toBe(400)
  })

  it('the platform org with no waiver needs a payout account like anyone', async () => {
    process.env.AGLYN_PLATFORM_ORG_ID = 'seller-org'
    mockPublisher.current = { orgId: 'seller-org', handle: 'aglyn' }
    expect((await refusalOf()).status).toBe(409)
  })

  it('a waiver on any other seller keeps its transfer and its payout gate', async () => {
    process.env.AGLYN_PLATFORM_ORG_ID = 'platform-org'
    seed({}, WAIVED)
    expect(await saleOf()).toMatchObject({
      platformSale: false,
      feeCents: 0,
      transferCents: 10000,
      accountId: 'acct_seller',
    })
    mockPublisher.current = { orgId: 'seller-org', handle: 'acme' }
    expect((await refusalOf()).status).toBe(409)
  })

  it('with no marker set, nobody sells as the platform', async () => {
    seed({}, WAIVED)
    mockPublisher.current = { orgId: 'seller-org', handle: 'aglyn' }
    expect((await refusalOf()).status).toBe(409)
  })
})
