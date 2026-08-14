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
 * Buying one component twice (AGL-1697).
 *
 * Two separate holes, closed two separate ways, and the distinction is the
 * whole design:
 *
 * 1. SEQUENTIAL. The route never asked whether the buyer already owned the
 *    listing. A stale tab or a bookmarked checkout charged them again for
 *    something they already had. That is a missing business rule, and it is
 *    fixed with the same `hasLivePurchase` predicate the install routes gate
 *    on — not with a key, because a key says nothing about a deliberate second
 *    purchase an hour later.
 *
 * 2. CONCURRENT. Between two clicks a second apart there is no purchase record
 *    yet to find, because the webhook writes it. Only the atomic claim covers
 *    that window, plus the `Idempotency-Key` that makes Stripe replay rather
 *    than open a second session.
 *
 * The Stripe boundary is mocked absolutely — `global.fetch` is replaced for the
 * whole file and every call counted. Nothing here may reach api.stripe.com;
 * localhost carries the LIVE secret key. Firestore is an in-memory map keyed by
 * document path, so the assertions COUNT the session calls and the claim
 * documents that actually landed rather than trusting the handler's response.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore — enough for the purchase QUERY and the atomic claim
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function makeSnapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => makeSnapshot(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      docs.set(
        path,
        options?.merge ? { ...(docs.get(path) ?? {}), ...value } : value,
      )
    },
    /**
     * Firestore rejects a create on an existing document, and that rejection IS
     * the dedupe primitive — the fake has to reproduce it faithfully or the
     * concurrency test proves nothing.
     */
    create: async (value: Record<string, any>) => {
      if (docs.has(path)) {
        const error: any = new Error(`ALREADY_EXISTS: ${path}`)
        error.code = 6
        throw error
      }
      docs.set(path, value)
    },
    delete: async () => {
      docs.delete(path)
    },
  }
}

/** `where(...).where(...).limit(n).get()`, filtering on equality only. */
function makeQuery(path: string, filters: Array<[string, unknown]>): any {
  return {
    where: (field: string, _op: string, value: unknown) =>
      makeQuery(path, [...filters, [field, value]]),
    limit: (n: number) => ({
      get: async () => ({
        docs: childPaths(path)
          .map(makeSnapshot)
          .filter((snapshot) =>
            filters.every(([field, value]) => snapshot.get(field) === value),
          )
          .slice(0, n),
      }),
    }),
  }
}

function makeCollectionRef(name: string): any {
  return {
    doc: (id: string) => makeDocRef(`${name}/${id}`),
    where: (field: string, op: string, value: unknown) =>
      makeQuery(name, []).where(field, op, value),
  }
}

const fakeFirestore = { collection: makeCollectionRef }

jest.mock('./publisher-profile', () => ({
  canActAsPublisher: async () =>
    (jest.requireMock('./publisher-profile') as { __isPublisher: boolean })
      .__isPublisher,
  resolvePublisherProfile: async () => ({
    orgId: 'seller-org',
    handle: 'acme',
    stripeAccountId: 'acct_seller',
    stripeChargesEnabled: true,
  }),
  __isPublisher: false,
}))

jest.mock('@aglyn/aglyn/server', () => {
  const entitlements = jest.requireActual(
    '@aglyn/aglyn/app-utils/plan-entitlements',
  )
  // The REAL claim, not a stub. The atomicity is the thing under test, so a
  // stub would leave the concurrency case asserting nothing at all.
  const idempotency = jest.requireActual('@aglyn/aglyn/app-utils/api-idempotency')
  return {
    buildRoute: (_route: string, params: Record<string, string>) =>
      `/${params.orgSlug}/marketplace`,
    Route: { ORG_MARKETPLACE: '/manage/marketplace' },
    checkEntitlement: entitlements.checkEntitlement,
    resolveMarketplaceFeePct: entitlements.resolveMarketplaceFeePct,
    claimAttempt: idempotency.claimAttempt,
  }
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({
          uid: 'buyer-1',
          email: 'buyer@example.com',
        }),
      }),
      firestore: () => fakeFirestore,
    }),
  },
}))

import { checkoutHandler } from './checkout'

const publisherMock = jest.requireMock('./publisher-profile') as {
  __isPublisher: boolean
}

// ---------------------------------------------------------------------------
// Stripe boundary — counted, never reached
// ---------------------------------------------------------------------------

const stripeCalls: Array<{ idempotencyKey: string | null }> = []
/** Mirrors Stripe's own replay, so "one session" can be told from "one call". */
const stripeSessionsByKey = new Map<string, string>()
let stripeSessionCounter = 0
let stripeFails = false

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined as any,
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

async function post(headers: Record<string, string> = {}) {
  const res = makeRes()
  await checkoutHandler(
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        origin: 'https://console.aglyn.com',
        ...headers,
      },
      body: { listingId: 'listing-1', hostId: 'host-1' },
    } as any,
    res,
  )
  return res
}

/** Every `apiIdempotency` claim document currently in the store. */
const claimDocs = () => childPaths('apiIdempotency')

function seed() {
  docs.clear()
  publisherMock.__isPublisher = false
  stripeFails = false
  stripeCalls.length = 0
  stripeSessionsByKey.clear()
  stripeSessionCounter = 0
  docs.set('marketplaceListings/listing-1', {
    priceUsd: 100,
    profileId: 'seller-org',
    displayName: 'Fancy hero',
    reviewStatus: 'listed',
  })
  docs.set('orgs/seller-org', { plan: 'pro', slug: 'acme' })
  docs.set('hostIndex/host-1', { orgId: 'buyer-org' })
  docs.set('orgs/buyer-org', { slug: 'buyer' })
}

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_spec'
})

beforeEach(() => {
  seed()
  global.fetch = jest.fn(async (url: any, init: any): Promise<any> => {
    const target = String(url)
    if (!target.includes('api.stripe.com')) {
      throw new Error(`Unexpected fetch to ${target}`)
    }
    const idempotencyKey =
      (init?.headers?.['Idempotency-Key'] as string | undefined) ?? null
    stripeCalls.push({ idempotencyKey })
    if (stripeFails) {
      return { ok: false, json: async () => ({ error: { message: 'nope' } }) }
    }
    if (idempotencyKey && stripeSessionsByKey.has(idempotencyKey)) {
      const replayed = stripeSessionsByKey.get(idempotencyKey) as string
      return { ok: true, json: async () => ({ url: replayed }) }
    }
    const sessionUrl = `https://checkout.stripe.com/c/session-${++stripeSessionCounter}`
    if (idempotencyKey) stripeSessionsByKey.set(idempotencyKey, sessionUrl)
    return { ok: true, json: async () => ({ url: sessionUrl }) }
  }) as unknown as typeof fetch
})

describe('a buyer cannot be charged twice for one listing (AGL-1697)', () => {
  it('THE DEFECT: a buyer who already owns the listing is sold it again', async () => {
    docs.set('marketplacePurchases/cs_prior', {
      buyerUid: 'buyer-1',
      listingId: 'listing-1',
    })
    const res = await post({ 'idempotency-key': 'attempt-a' })
    expect(res.statusCode).toBe(409)
    expect(res.body.code).toBe('already_purchased')
    // The measurement: no session reached the live account.
    expect(stripeCalls).toHaveLength(0)
  })

  it('THE DEFECT: a double-submit of one attempt opens two Checkout sessions', async () => {
    // Concurrent, so no purchase record exists yet for the check above to
    // find — the webhook has not run. Only the atomic claim covers this.
    const [first, second] = await Promise.all([
      post({ 'idempotency-key': 'attempt-a' }),
      post({ 'idempotency-key': 'attempt-a' }),
    ])
    expect(stripeCalls).toHaveLength(1)
    expect(stripeSessionsByKey.size).toBe(1)
    const statuses = [first.statusCode, second.statusCode].sort()
    expect(statuses).toEqual([200, 409])
  })

  it('THE DEFECT: Stripe was handed no Idempotency-Key at all', async () => {
    await post({ 'idempotency-key': 'attempt-a' })
    expect(stripeCalls).toHaveLength(1)
    expect(stripeCalls[0].idempotencyKey).toBeTruthy()

    // With our claim wiped — the window where it was written but the response
    // never arrived — the handler calls again and STRIPE absorbs it, because
    // the key is derived from the attempt rather than freshly minted.
    for (const path of claimDocs()) docs.delete(path)
    await post({ 'idempotency-key': 'attempt-a' })
    expect(stripeCalls).toHaveLength(2)
    expect(stripeCalls[1].idempotencyKey).toBe(stripeCalls[0].idempotencyKey)
    expect(stripeSessionsByKey.size).toBe(1)
  })

  it('replays the SAME session url for a repeat of one attempt', async () => {
    const first = await post({ 'idempotency-key': 'attempt-a' })
    const repeat = await post({ 'idempotency-key': 'attempt-a' })
    expect(repeat.statusCode).toBe(200)
    expect(repeat.body.url).toBe(first.body.url)
    expect(stripeCalls).toHaveLength(1)
  })

  it('CONTROL — a refunded buyer buys again', async () => {
    // `hasLivePurchase` reads a fully refunded purchase as absent (AGL-1546).
    // Sharing that predicate with the install routes is what makes this true
    // here for free; a second query beside it would have had to relearn it.
    docs.set('marketplacePurchases/cs_prior', {
      buyerUid: 'buyer-1',
      listingId: 'listing-1',
      refundedAt: 1_700_000_000_000,
    })
    const res = await post({ 'idempotency-key': 'attempt-a' })
    expect(res.statusCode).toBe(200)
    expect(stripeCalls).toHaveLength(1)
  })

  it('CONTROL — someone else’s purchase of the same listing does not block this buyer', async () => {
    docs.set('marketplacePurchases/cs_other', {
      buyerUid: 'buyer-2',
      listingId: 'listing-1',
    })
    expect((await post({ 'idempotency-key': 'attempt-a' })).statusCode).toBe(200)
    expect(stripeCalls).toHaveLength(1)
  })

  it('CONTROL — a DIFFERENT attempt key opens a real second session', async () => {
    // The case that fails if the key is ever derived from the CONTENT. Nothing
    // about the request changes between these two; only the attempt does. The
    // business rule above is what stops a duplicate PURCHASE — the key must not
    // be asked to do that job, or a legitimate re-buy after a refund dies with
    // it.
    await post({ 'idempotency-key': 'attempt-a' })
    await post({ 'idempotency-key': 'attempt-b' })
    expect(stripeCalls).toHaveLength(2)
    expect(stripeSessionsByKey.size).toBe(2)
  })

  it('CONTROL — no key at all still sells, and dedupes nothing', async () => {
    // An older cached bundle must not start failing purchases.
    await post()
    await post()
    expect(stripeCalls).toHaveLength(2)
    expect(stripeCalls[0].idempotencyKey).toBeNull()
    expect(claimDocs()).toHaveLength(0)
  })

  it('a failed Stripe call releases the claim', async () => {
    stripeFails = true
    expect((await post({ 'idempotency-key': 'attempt-a' })).statusCode).toBe(502)
    expect(claimDocs()).toHaveLength(0)

    // Same key, and the buyer is not locked out of this listing.
    stripeFails = false
    expect((await post({ 'idempotency-key': 'attempt-a' })).statusCode).toBe(200)
    expect(stripeCalls).toHaveLength(2)
  })

  it('a deterministic refusal does not burn the key', async () => {
    // Self-purchase: a publisher testing their own listing from the wrong
    // account fixes it by switching account and pressing the same button.
    publisherMock.__isPublisher = true
    expect((await post({ 'idempotency-key': 'attempt-a' })).statusCode).toBe(400)
    expect(claimDocs()).toHaveLength(0)

    publisherMock.__isPublisher = false
    expect((await post({ 'idempotency-key': 'attempt-a' })).statusCode).toBe(200)
    expect(stripeCalls).toHaveLength(1)
  })

  it('carries the BUYER’s org on the claim, so org erasure sweeps it', async () => {
    // `eraseOrgIdempotencyKeys` (AGL-1448) queries this collection by `orgId`;
    // a claim written without one is undeletable debt against a dead org.
    await post({ 'idempotency-key': 'attempt-a' })
    const claim = docs.get(claimDocs()[0] as string)
    expect(claim?.['orgId']).toBe('buyer-org')
    expect(claim?.['kind']).toBe('marketplace-checkout')
  })
})
