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
import { resolveTransactionFeePct, saleProcessingCostCents } from '@aglyn/aglyn/server'
import { cartCheckoutHandler } from './cart-checkout'
import {
  registerPluginPaymentProvider,
  type PluginPaymentCheckoutRequest,
  type PluginPaymentProvider,
} from '@aglyn/aglyn/plugin-manager/plugin-payment-providers'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { PROVIDER_TAX_MESSAGE, PROVIDER_UNAVAILABLE_MESSAGE } from './provider-checkout'

/**
 * A cart paid through another plugin's payment provider (AGL-3630).
 *
 * The same handler prices the sale — lines, holds, discounts, gift cards,
 * shipping, tax, the fee — and only the last step differs: the provider is
 * handed amounts instead of a Checkout Session being created. So this file
 * asserts three things: a card checkout builds byte-for-byte the session it
 * built before, whether or not a provider is registered; a provider checkout
 * makes NO Stripe call at all (no session, no coupon, no tax-rate object) and
 * hands the provider exactly what the card path would have charged, with the
 * platform's transaction fee alone; and a provider that is not offered, or a
 * store whose tax the card processor calculates, is refused before anything
 * is held.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
let autoIdCounter = 0

/**
 * `FieldValue.delete()`, and the deep merge it exists to defeat (AGL-2449).
 *
 * The gift-card block now places a HOLD in a transaction rather than reading a
 * balance, and the hold lives in a nested `holds` map. Firestore merges nested
 * maps key-by-key, so a locally-pruned copy does not remove anything — only
 * this sentinel does. A double that merged shallowly would report green for a
 * settlement that silently decrements a card twice on a webhook redelivery,
 * which is precisely the bug the sentinel was introduced to close.
 */
const DELETE = Symbol('FieldValue.delete')

function mergeInto(
  target: Record<string, any>,
  patch: Record<string, any>,
): Record<string, any> {
  const next = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    if (value === DELETE) {
      delete next[key]
    } else if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      value.constructor === Object
    ) {
      next[key] = mergeInto(
        (next[key] && typeof next[key] === 'object' ? next[key] : {}) as any,
        value,
      )
    } else {
      next[key] = value
    }
  }
  return next
}

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
        options?.merge ? mergeInto(docs.get(path) ?? {}, value) : value,
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

/**
 * Buffers reads and writes the way a Firestore transaction does. Contention is
 * NOT modelled here — this file drives one checkout at a time, and the
 * concurrent case has its own spec (`gift-card-hold-race.spec.ts`) whose double
 * tracks per-document versions and re-runs an aborted callback. Pretending to
 * model it here without the version tracking would be the worse option: a fake
 * that always commits reports green for a race it never ran.
 */
async function runTransaction(
  body: (transaction: any) => Promise<any>,
): Promise<any> {
  const writes: { path: string; value: Record<string, any>; merge: boolean }[] =
    []
  const transaction = {
    get: async (ref: any) => makeSnapshot(ref.path),
    set: (ref: any, value: Record<string, any>, options?: any) => {
      writes.push({ path: ref.path, value, merge: Boolean(options?.merge) })
    },
    update: (ref: any, value: Record<string, any>) => {
      writes.push({ path: ref.path, value, merge: true })
    },
    create: (ref: any, value: Record<string, any>) => {
      writes.push({ path: ref.path, value, merge: false })
    },
  }
  const result = await body(transaction)
  for (const write of writes) {
    docs.set(
      write.path,
      write.merge ? mergeInto(docs.get(write.path) ?? {}, write.value) : write.value,
    )
  }
  return result
}

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
  runTransaction,
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
  /*
   * The real resolution's shape: an org that declared no pooling resolves
   * every site to a group of ONE. Faked rather than imported because this
   * file mocks the whole module — but faked to the NARROW answer, which is
   * the direction a wrong group may fail in.
   */
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
    firestore: { FieldValue: { delete: () => DELETE } },
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

const opened: PluginPaymentCheckoutRequest[] = []
let walletFails = false

const wallet: PluginPaymentProvider = {
  available: async () => ({
    providerId: 'wallet',
    label: 'Wallet',
    methods: [{ id: 'wallet', label: 'Wallet' }],
    livemode: false,
  }),
  createCheckout: async (request) => {
    opened.push(request)
    if (walletFails) throw new Error('wallet down')
    return {
      providerId: 'wallet',
      providerCheckoutId: `w_${opened.length}`,
      redirectUrl: `https://acme.aglyn.app/api/wallet/pay?c=w_${opened.length}`,
      livemode: false,
    }
  },
  refund: async () => ({ ok: true, refundId: 'r', status: 'completed' }),
}

/** An 8.25% Texas rate, taxing by origin. */
const MANUAL_TX = {
  tax: {
    mode: 'manual',
    origin: { country: 'US', state: 'TX' },
    rates: [{ country: 'US', state: 'TX', pct: 8.25, label: 'TX sales tax' }],
  },
}

beforeEach(() => {
  resetPluginServicesForTests()
  opened.length = 0
  walletFails = false
})

describe('a card checkout is unchanged by a provider being registered (AGL-3630)', () => {
  it('sends Stripe the same session, byte for byte', async () => {
    docs.set('hosts/host-1/settings/store', MANUAL_TX)
    const before = await post({ couponCode: 'SAVE10' }, { 'idempotency-key': 'attempt-card' })
    expect(before.status).toBe(200)
    const sessionBefore = sessionCalls()[0].params.toString()
    const couponBefore = couponCalls()[0].params.toString()

    // The same store and cart again, now with a provider registered and offered.
    docs.clear()
    stripeCalls.length = 0
    stripeResponsesByKey.clear()
    stripeObjectCounter = 0
    docs.set(`hosts/host-1/carts/${CART_ID}`, { lines: [{ productId: 'product-1', quantity: 2 }] })
    docs.set('hosts/host-1/products/product-1', {
      name: 'Walnut desk',
      type: 'physical',
      status: 'active',
      variants: [{ id: 'default', priceUsd: 40, inventory: null }],
    })
    docs.set('hosts/host-1/settings/store', MANUAL_TX)
    docs.set('hosts/host-1/coupons/SAVE10', { percentOff: 10, enabled: true })
    docs.set('profiles/owner-1', { stripeAccountId: 'acct_live_merchant', stripeChargesEnabled: true })
    registerPluginPaymentProvider('wallet', wallet, { pluginId: 'wallet-plugin' })
    const after = await post({ couponCode: 'SAVE10' }, { 'idempotency-key': 'attempt-card' })
    expect(after.status).toBe(200)
    expect(sessionCalls()[0].params.toString()).toBe(sessionBefore)
    expect(couponCalls()[0].params.toString()).toBe(couponBefore)
    expect(opened).toHaveLength(0)
  })
})

describe('a provider checkout (AGL-3630)', () => {
  beforeEach(() => {
    registerPluginPaymentProvider('wallet', wallet, { pluginId: 'wallet-plugin' })
    docs.set('hosts/host-1/settings/store', MANUAL_TX)
  })

  it('hands the provider the priced sale and makes no Stripe call', async () => {
    const result = await post(
      { paymentProvider: 'wallet', couponCode: 'SAVE10', email: 'ada@example.com' },
      { 'idempotency-key': 'attempt-wallet' },
    )
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ url: 'https://acme.aglyn.app/api/wallet/pay?c=w_1' })
    expect(stripeCalls).toEqual([])
    expect(opened).toHaveLength(1)
    const request = opened[0]
    // 2 × $40, 10% off, 8.25% on the discounted $72.
    expect(request.lines).toEqual([{ name: 'Walnut desk', quantity: 2, unitCents: 4_000, ships: true }])
    expect(request.discountCents).toBe(800)
    expect(request.taxCents).toBe(594)
    expect(request.currency).toBe('usd')
    expect(request.ownerKind).toBe('commerce-cart')
    expect(request.checkoutId).toMatch(/^pay_wallet_[0-9a-f]{32}$/)
    expect(request.shipping).toEqual({
      options: [{ id: 'standard', label: 'Shipping', amountCents: 0 }],
      countries: expect.arrayContaining(['US']),
    })
    // The transaction fee alone, scaled by the discount as the card path
    // scales it — not the card processor's cost on top: the provider bills
    // the merchant its own processing.
    const pct = resolveTransactionFeePct(mockOrg.org, 'physical')
    const expectedFee = Math.max(pct > 0 ? 1 : 0, Math.round((Math.round((8_000 * pct) / 100) * 7_200) / 8_000))
    expect(request.platformFeeCents).toBe(expectedFee)
    expect(request.metadata['feeCents']).toBe(String(expectedFee))
    expect(saleProcessingCostCents(7_794)).toBeGreaterThan(0)
    expect(request.metadata).toMatchObject({
      type: 'commerce-cart',
      hostId: 'host-1',
      cartId: CART_ID,
      couponCode: 'SAVE10',
      paymentProvider: 'wallet',
    })
    expect(request.returnUrl).toContain(`session_id=${request.checkoutId}`)
    expect(request.buyerEmail).toBe('ada@example.com')
    // The checkout the abandoned-cart emails are built on, under the provider's id.
    expect(docs.get(`hosts/host-1/checkouts/${request.checkoutId}`)).toMatchObject({
      status: 'open',
      paymentProvider: 'wallet',
      cartId: CART_ID,
    })
  })

  it('replays a retried attempt without opening a second checkout', async () => {
    const first = await post({ paymentProvider: 'wallet' }, { 'idempotency-key': 'attempt-w' })
    const second = await post({ paymentProvider: 'wallet' }, { 'idempotency-key': 'attempt-w' })
    expect(second.body).toEqual(first.body)
    expect(opened).toHaveLength(1)
  })

  it('treats the card and the provider as different attempts of one cart', async () => {
    await post({ paymentProvider: 'wallet' }, { 'idempotency-key': 'attempt-w' })
    await post({}, { 'idempotency-key': 'attempt-c' })
    expect(opened).toHaveLength(1)
    expect(sessionCalls()).toHaveLength(1)
  })

  it('refuses a provider that is not offered, holding nothing', async () => {
    const result = await post({ paymentProvider: 'elsewhere' }, { 'idempotency-key': 'attempt-x' })
    expect(result).toEqual({ status: 409, body: { error: PROVIDER_UNAVAILABLE_MESSAGE } })
    expect(stripeCalls).toEqual([])
    expect(claimDocs()).toHaveLength(0)
  })

  it('refuses every provider where the card processor calculates tax', async () => {
    docs.set('hosts/host-1/settings/store', { tax: { mode: 'stripe' } })
    const result = await post({ paymentProvider: 'wallet' }, { 'idempotency-key': 'attempt-x' })
    expect(result).toEqual({ status: 409, body: { error: PROVIDER_TAX_MESSAGE } })
    expect(opened).toHaveLength(0)
  })

  it('gives back the hold and the key when the provider refuses', async () => {
    walletFails = true
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await post({ paymentProvider: 'wallet', couponCode: 'SAVE10' }, { 'idempotency-key': 'attempt-f' })
    error.mockRestore()
    expect(result.status).toBe(502)
    expect(claimDocs()).toHaveLength(0)
    expect(docs.get('hosts/host-1/coupons/SAVE10')?.['holds'] ?? {}).toEqual({})
    expect(checkoutDocs()).toHaveLength(0)
  })

  it('sends a fully covered order to the card checkout, which handles a zero total', async () => {
    docs.set('hosts/host-1/settings/store', { tax: { mode: 'none' } })
    docs.set('hosts/host-1/giftCards/BIGCARD', { balanceCents: 50_000 })
    docs.set('hosts/host-1/products/product-1', {
      name: 'E-book',
      type: 'digital',
      status: 'active',
      variants: [{ id: 'default', priceUsd: 40, inventory: null }],
    })
    const result = await post({ paymentProvider: 'wallet', giftCardCode: 'BIGCARD' }, { 'idempotency-key': 'attempt-g' })
    expect(result.status).toBe(409)
    expect(opened).toHaveLength(0)
    expect(claimDocs()).toHaveLength(0)
  })
})
