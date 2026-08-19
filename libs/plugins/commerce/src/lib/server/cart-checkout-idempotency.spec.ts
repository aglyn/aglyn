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

import type {
  PluginApiRequest,
  PluginApiResponse,
} from '@aglyn/aglyn/server'
import { cartCheckoutHandler } from './cart-checkout'

/**
 * Cart checkout idempotency (AGL-1697, item 5).
 *
 * The multi-object attempt: one checkout can post up to two `/v1/coupons`
 * (a discount or legacy coupon, plus a gift card) AND a Checkout session. The
 * cart is not consumed until the webhook clears it, so before the claim one
 * cart could spawn unlimited sessions — each retry leaving an orphan
 * `checkouts/{sessionId}` doc that drives the AGL-323 abandoned-cart emails,
 * plus a stray coupon object on the merchant's live account.
 *
 * The AGL-1714 rule under test alongside the claim: Stripe's idempotency
 * layer is account-scoped and parameter-compared, so ONE digest sent to both
 * `/v1/coupons` and `/v1/checkout/sessions` would make the second call fail
 * outright. Each object derives its own key from the one digest, and the
 * derived keys must be pairwise distinct.
 *
 * `global.fetch` is replaced for the whole file — nothing here may reach
 * api.stripe.com, localhost carries the LIVE secret key.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
let autoIdCounter = 0

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
    /** `create()` rejecting on an existing doc IS the dedupe primitive. */
    create: async (value: Record<string, any>) => {
      if (docs.has(path)) {
        const error: any = new Error(
          `ALREADY_EXISTS: entity already exists: ${path}`,
        )
        error.code = 6
        throw error
      }
      docs.set(path, value)
    },
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  return {
    doc: (id?: string) =>
      makeDocRef(`${path}/${id ?? `auto-${++autoIdCounter}`}`),
    get: async () => ({ docs: childPaths(path).map(makeSnapshot) }),
    /** The discounts read is `limit(100).get()` straight off the collection. */
    limit: (_count: number) => ({
      get: async () => ({ docs: childPaths(path).map(makeSnapshot) }),
    }),
  }
}

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
}

const mockOrg: any = {
  org: {
    id: 'org-1',
    plan: 'business',
    subscriptionStatus: 'active',
    ownerUid: 'owner-1',
    slug: 'acme',
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
  },
  getOrgForHost: async () => mockOrg,
}))

// ---------------------------------------------------------------------------
// Stripe boundary — counted, never reached
// ---------------------------------------------------------------------------

interface StripeCall {
  url: string
  idempotencyKey: string | null
  params: URLSearchParams
}

const stripeCalls: StripeCall[] = []
/** Keyed responses, mirroring Stripe's own replay-for-a-repeated-key. */
const stripeResponsesByKey = new Map<string, any>()
let stripeObjectCounter = 0

function couponCalls() {
  return stripeCalls.filter((call) => call.url.includes('/coupons'))
}

function sessionCalls() {
  return stripeCalls.filter((call) => call.url.includes('checkout/sessions'))
}

const fetchMock = jest.fn(async (url: any, init: any): Promise<any> => {
  const target = String(url)
  if (!target.includes('api.stripe.com')) {
    throw new Error(`Unexpected fetch to ${target}`)
  }
  const idempotencyKey =
    (init?.headers?.['Idempotency-Key'] as string | undefined) ?? null
  stripeCalls.push({
    url: target,
    idempotencyKey,
    params: new URLSearchParams(String(init?.body ?? '')),
  })
  if (idempotencyKey && stripeResponsesByKey.has(idempotencyKey)) {
    return {
      ok: true,
      json: async () => stripeResponsesByKey.get(idempotencyKey),
    }
  }
  const payload = target.includes('/coupons')
    ? { id: `coupon_${++stripeObjectCounter}` }
    : {
        id: `cs_${++stripeObjectCounter}`,
        url: `https://checkout.stripe.com/pay/session-${stripeObjectCounter}`,
      }
  if (idempotencyKey) stripeResponsesByKey.set(idempotencyKey, payload)
  return { ok: true, json: async () => payload }
})

// ---------------------------------------------------------------------------
// Request / response plumbing
// ---------------------------------------------------------------------------

const CART_ID = 'cart-abc123'

function makeResponse() {
  const result = { status: 0, body: undefined as any }
  const res: PluginApiResponse = {
    status(code) {
      result.status = code
      return res
    },
    json(body) {
      result.body = body
    },
    send(body) {
      result.body = body
    },
    setHeader() {
      // unused
    },
    redirect() {
      // unused
    },
    end() {
      // unused
    },
  } as PluginApiResponse
  return { res, result }
}

async function post(
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const { res, result } = makeResponse()
  const request = {
    method: 'POST',
    query: {},
    body: { hostId: 'host-1', ...body },
    headers: { host: 'acme.aglyn.app', ...headers },
    cookies: { 'aglyn_cart_host-1': CART_ID },
    socket: {},
  } as unknown as PluginApiRequest
  await cartCheckoutHandler(request, res)
  return result
}

function checkoutDocs() {
  return childPaths('hosts/host-1/checkouts')
}

function claimDocs() {
  return childPaths('apiIdempotency')
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
})

beforeEach(() => {
  docs.clear()
  stripeCalls.length = 0
  stripeResponsesByKey.clear()
  autoIdCounter = 0
  stripeObjectCounter = 0
  fetchMock.mockClear()

  docs.set(`hosts/host-1/carts/${CART_ID}`, {
    lines: [{ productId: 'product-1', quantity: 2 }],
  })
  docs.set('hosts/host-1/products/product-1', {
    name: 'Walnut desk',
    type: 'physical',
    status: 'active',
    variants: [{ id: 'default', priceUsd: 40, inventory: null }],
  })
  // AGL-1999: an unconfigured store now REFUSES the sale, so a fixture
  // that means "this store charges no tax" has to say so.
  docs.set('hosts/host-1/settings/store', { tax: { mode: 'none' } })
  docs.set('hosts/host-1/coupons/SAVE10', { percentOff: 10, enabled: true })
  docs.set('hosts/host-1/giftCards/GIFTCARD1', { balanceCents: 500 })
  docs.set('profiles/owner-1', {
    stripeAccountId: 'acct_live_merchant',
    stripeChargesEnabled: true,
  })
})

// ---------------------------------------------------------------------------

describe('cart checkout idempotency (AGL-1697)', () => {
  it('creates one session with a recoverable checkout doc and records the claim', async () => {
    const result = await post({}, { 'idempotency-key': 'attempt-a' })
    expect(result.status).toBe(200)
    expect(result.body.url).toContain('checkout.stripe.com')
    expect(sessionCalls()).toHaveLength(1)
    expect(couponCalls()).toHaveLength(0)
    expect(checkoutDocs()).toHaveLength(1)
    expect(claimDocs()).toHaveLength(1)
    expect(docs.get(claimDocs()[0])?.['status']).toBe('done')
  })

  /**
   * THE DEFECT. The cart is not consumed until the webhook clears it, so a
   * doubled request minted a second session from the SAME cart — and a second
   * orphan `checkouts/{sessionId}` doc, which is what feeds the AGL-323
   * abandoned-cart recovery emails.
   */
  it('replays a retried checkout instead of spawning a second session', async () => {
    const first = await post({}, { 'idempotency-key': 'attempt-a' })
    const second = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body.url).toBe(first.body.url)
    expect(sessionCalls()).toHaveLength(1)
    // One recoverable-checkout doc — not an orphan per retry.
    expect(checkoutDocs()).toHaveLength(1)
  })

  /**
   * The AGL-1714 decomposition, re-cut by AGL-2112.
   *
   * This case used to assert TWO coupon objects for a coupon + gift-card cart,
   * and three distinct derived keys. That count was the DEFECT wearing a
   * guard's clothes: a Checkout Session takes exactly one entry in
   * `discounts`, and the three blocks that minted those objects each did
   * `params.set('discounts[0][coupon]', …)`, so the second mint replaced the
   * first on the session and the shopper never received it. Two coupons was
   * never a healthy number — it was one real discount and one orphan.
   *
   * The invariant AGL-1714 actually cares about is unchanged and still
   * asserted: every Stripe object carries its OWN derivation of the one
   * digest (Stripe parameter-compares a repeated key, so a shared one errors
   * the second call), and a doubled request adds ZERO calls.
   */
  it('mints ONE coupon for a coupon + gift-card cart, and a retry re-mints nothing', async () => {
    const body = { couponCode: 'SAVE10', giftCardCode: 'GIFTCARD1' }
    const first = await post(body, { 'idempotency-key': 'attempt-b' })
    expect(first.status).toBe(200)
    // One discount object, carrying both reductions.
    expect(couponCalls()).toHaveLength(1)
    expect(sessionCalls()).toHaveLength(1)
    const keys = stripeCalls.map((call) => call.idempotencyKey)
    for (const key of keys) expect(key).toBeTruthy()
    expect(new Set(keys).size).toBe(2)

    const second = await post(body, { 'idempotency-key': 'attempt-b' })
    expect(second.status).toBe(200)
    expect(second.body.url).toBe(first.body.url)
    // Still two calls TOTAL: no stray coupon, no second session.
    expect(stripeCalls).toHaveLength(2)
  })

  it('opens a genuinely new checkout under a fresh attempt key', async () => {
    await post({}, { 'idempotency-key': 'attempt-a' })
    const second = await post({}, { 'idempotency-key': 'attempt-b' })
    expect(second.status).toBe(200)
    expect(sessionCalls()).toHaveLength(2)
    expect(checkoutDocs()).toHaveLength(2)
  })

  /**
   * The release-on-deterministic-failure rule (AGL-1714), strengthened by
   * AGL-2112.
   *
   * An empty gift card is a 400 the shopper fixes and retries. This case used
   * to assert that a real coupon object ALREADY existed on the merchant's
   * account by then, and that the retry re-derived its key so Stripe replayed
   * it rather than minting a twin. Since every reduction is now resolved
   * before anything is minted, the refusal happens with NOTHING minted — the
   * strictly better outcome, and the one asserted here. The rule itself is
   * unchanged: the claim is released so the retry can proceed.
   */
  it('releases the key when the gift card refuses, having minted nothing', async () => {
    docs.set('hosts/host-1/giftCards/EMPTY', { balanceCents: 0 })
    const refused = await post(
      { couponCode: 'SAVE10', giftCardCode: 'EMPTY' },
      { 'idempotency-key': 'attempt-c' },
    )
    expect(refused.status).toBe(400)
    // Nothing was minted against the merchant's account for a cart that never
    // checked out — no orphan coupon to reconcile later.
    expect(couponCalls()).toHaveLength(0)
    expect(sessionCalls()).toHaveLength(0)
    expect(claimDocs()).toHaveLength(0)

    const retry = await post(
      { couponCode: 'SAVE10', giftCardCode: 'GIFTCARD1' },
      { 'idempotency-key': 'attempt-c' },
    )
    expect(retry.status).toBe(200)
    // The retry mints the one coupon it needs, and only then.
    expect(couponCalls()).toHaveLength(1)
    expect(couponCalls()[0].idempotencyKey).toBeTruthy()
  })

  /** A failed session releases the claim so the cart is not locked out. */
  it('releases the claim when the session fails', async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      json: async () => ({ error: { message: 'nope' } }),
    }))
    const failed = await post({}, { 'idempotency-key': 'attempt-d' })
    expect(failed.status).toBe(502)
    expect(claimDocs()).toHaveLength(0)
    expect(checkoutDocs()).toHaveLength(0)

    const retry = await post({}, { 'idempotency-key': 'attempt-d' })
    expect(retry.status).toBe(200)
    expect(checkoutDocs()).toHaveLength(1)
  })

  /**
   * Backwards compatibility: an older cached storefront bundle sends no key
   * and must keep checking out — deduping nothing, exactly as before.
   */
  it('still checks out without a key, and dedupes nothing', async () => {
    await post()
    await post()
    expect(sessionCalls()).toHaveLength(2)
    expect(checkoutDocs()).toHaveLength(2)
    expect(claimDocs()).toHaveLength(0)
    expect(sessionCalls()[0].idempotencyKey).toBeNull()
  })
})

/**
 * DISCOUNT STACKING ON A CART CHECKOUT (AGL-2112).
 *
 * Lives in this file rather than its own because the harness it needs is
 * exactly this one — a fake Stripe that records every call's parameters — and
 * a second 250-line copy of that harness is how two suites end up disagreeing
 * about what the same handler does.
 *
 * THE DEFECT. A Checkout Session takes exactly one entry in `discounts`. The
 * handler had three independent blocks (AGL-305 discount, AGL-96 coupon code,
 * AGL-322 gift card), each minting its own Stripe coupon and each calling
 * `params.set('discounts[0][coupon]', …)`. `URLSearchParams.set` REPLACES, so
 * a cart carrying a coupon AND a gift card sent only the gift card's coupon —
 * the shopper paid the coupon's worth too much, a real orphan coupon object
 * was left on the merchant's account, and the webhook still burned the
 * coupon's redemption against `maxRedemptions`.
 *
 * Forced red by restoring any one of the three `params.set` calls: the
 * `amount_off` assertion below reads the last reduction instead of the sum.
 */
describe('a coupon and a gift card both reach the session (AGL-2112)', () => {
  /** Basket: 2 × $40 = 8000c. SAVE10 is 10% = 800c. */
  const ITEMS_CENTS = 8000

  it('mints one coupon worth the SUM of every reduction', async () => {
    docs.set('hosts/host-1/giftCards/BIG', { balanceCents: 4000 })
    const result = await post({ couponCode: 'SAVE10', giftCardCode: 'BIG' })
    expect(result.status).toBe(200)
    expect(couponCalls()).toHaveLength(1)
    // 800 (the coupon) + 4000 (the card) = 4800. The defect sent 4000 — the
    // gift card alone — and 800 of the shopper's discount vanished.
    expect(couponCalls()[0].params.get('amount_off')).toBe('4800')
    expect(couponCalls()[0].params.get('duration')).toBe('once')
    // Both are recorded, so the webhook can burn the redemption and decrement
    // the card against a session that actually carried them.
    expect(sessionCalls()[0].params.get('metadata[couponCode]')).toBe('SAVE10')
    expect(sessionCalls()[0].params.get('metadata[giftCardCode]')).toBe('BIG')
    expect(sessionCalls()[0].params.get('metadata[giftCardCents]')).toBe('4000')
  })

  /**
   * The gift card applies against what is LEFT, not against the whole basket.
   * The old cap was `min(balance, itemsCents)`, and the webhook decrements the
   * card by exactly `metadata[giftCardCents]` — so a card bigger than the
   * post-coupon remainder had the difference burned off it for nothing.
   */
  it('caps the gift card at the post-coupon remainder', async () => {
    docs.set('hosts/host-1/giftCards/HUGE', { balanceCents: 100000 })
    await post({ couponCode: 'SAVE10', giftCardCode: 'HUGE' })
    // 8000 - 800 = 7200 of goods left for the card to cover.
    expect(sessionCalls()[0].params.get('metadata[giftCardCents]')).toBe('7200')
    // And the coupon never exceeds the basket.
    expect(Number(couponCalls()[0].params.get('amount_off'))).toBe(ITEMS_CENTS)
  })

  /**
   * The platform fee is scaled ONCE, by the reduction that actually reached
   * the session. Three blocks meant up to three compounding reductions for one
   * discount, so Aglyn under-charged its own cut on exactly the carts that
   * stacked. Driven on a DIGITAL product because Business — the fixture's
   * plan — charges a deliberate 0% on physical goods, and a fee assertion at
   * zero cannot fail.
   */
  it('scales the platform fee once, by the total reduction', async () => {
    docs.set('hosts/host-1/products/product-1', {
      name: 'Desk plans PDF',
      type: 'digital',
      status: 'active',
      variants: [{ id: 'default', priceUsd: 40, inventory: null }],
    })
    docs.set('hosts/host-1/giftCards/BIG', { balanceCents: 4000 })
    await post({ couponCode: 'SAVE10', giftCardCode: 'BIG' })
    // Business digital is 2%: 2% of 8000 = 160. Reduced by 4800 of 8000, so
    // 160 × 3200/8000 = 64. The compounding defect sent 72
    // (160 × 0.9 = 144, then 144 × 4000/8000).
    expect(
      sessionCalls()[0].params.get(
        'payment_intent_data[application_fee_amount]',
      ),
    ).toBe('64')
    expect(sessionCalls()[0].params.get('metadata[feeCents]')).toBe('64')
  })

  /**
   * NEGATIVE CONTROL. A cart with no code and no card mints no coupon and
   * sends no `discounts` entry — otherwise the assertions above would pass
   * against a handler that discounts everything unconditionally.
   */
  it('sends no discount at all when the cart carries neither', async () => {
    const result = await post({})
    expect(result.status).toBe(200)
    expect(couponCalls()).toHaveLength(0)
    expect(sessionCalls()[0].params.has('discounts[0][coupon]')).toBe(false)
  })
})
