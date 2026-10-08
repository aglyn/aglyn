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
import { cartCheckoutHandler, CHECKOUT_CREDIT_INVALID_MESSAGE } from './cart-checkout'
import {
  decodeCheckoutCreditMetadata,
  registerPluginCheckoutCredit,
  type PluginCheckoutCreditProvider,
} from '@aglyn/aglyn/plugin-manager/plugin-checkout-credits'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { cartExtrasHandler } from './checkout-extras'

/**
 * Store credit another plugin keeps (AGL-3640) reaches the Checkout Session
 * only through core's checkout-credits seam: the code is resolved and HELD by
 * its provider before Stripe is asked, against what is left after every other
 * reduction; the held cents join the one session coupon; the metadata carries
 * the hold — never the code — for the webhook to settle; and every refusal,
 * the provider's or Stripe's, lets the hold go.
 *
 * The harness is `cart-checkout-extras.spec.ts`'s: Stripe is mocked
 * absolutely and the assertions read the form body the handler built.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
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
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  const ref: any = {
    doc: (id: string) => makeDocRef(`${path}/${id}`),
    limit: () => ref,
    get: async () => ({ docs: childPaths(path).map(makeSnapshot) }),
  }
  return ref
}

/**
 * A transaction, because the code under test now uses one (AGL-2356).
 *
 * Checkout reserves the units it is about to sell inside a Firestore
 * transaction, so a double without `runTransaction` is not a Firestore and this
 * file's handler fails before it reaches anything this file is about. Reads and
 * writes go through the same doc refs as everything else here, and writes are
 * applied on commit.
 *
 * NO VERSIONING and no retry: nothing in this file tests contention, and a fake
 * that pretended to model it would be decoration. The contention is proved in
 * `stock-hold-race.spec.ts`, which versions every document and re-runs a
 * callback whose read went stale.
 */
async function runTransaction(
  body: (transaction: any) => Promise<any>,
): Promise<any> {
  const writes: Array<() => Promise<void>> = []
  const result = await body({
    get: async (ref: any) => ref.get(),
    set: (ref: any, value: any, options?: any) => {
      writes.push(() => ref.set(value, options))
    },
    update: (ref: any, value: any) => {
      writes.push(() => ref.set(value, { merge: true }))
    },
    create: (ref: any, value: any) => {
      writes.push(() => ref.set(value))
    },
  })
  for (const write of writes) await write()
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
  firebaseAdmin: { app: () => ({ firestore: () => fakeFirestore }) },
  getOrgForHost: async () => mockOrg,
}))

// ---------------------------------------------------------------------------
// Stripe boundary — captured, never reached
// ---------------------------------------------------------------------------

let sessionBody: URLSearchParams | null = null
let couponFails = false

/** `amount_off` on every coupon the handler minted, in call order. */
const couponAmounts: string[] = []
const fetchMock = jest.fn(async (url: any, init: any): Promise<any> => {
  const target = String(url)
  if (!target.startsWith('https://api.stripe.com')) {
    throw new Error(`Unexpected fetch to ${target}`)
  }
  if (target.endsWith('/v1/checkout/sessions')) {
    sessionBody = new URLSearchParams(String(init?.body ?? ''))
    return {
      ok: true,
      json: async () => ({
        id: 'cs_test_1',
        url: 'https://checkout.stripe.com/pay/cs_test_1',
      }),
    }
  }
  // A real endpoint with a real side effect: every call CREATES a coupon
  // object on the merchant's account. Modelled so the ordering assertion
  // below — that a refused checkout creates none — can be made at all.
  if (target.endsWith('/v1/coupons')) {
    if (couponFails) return { ok: false, json: async () => ({ error: { message: 'down' } }) }
    // The MONEY on a discount: `amount_off` is what Stripe takes off the
    // session, so it is the assertion surface for any pricing question.
    couponAmounts.push(
      String(new URLSearchParams(String(init?.body ?? '')).get('amount_off')),
    )
    return { ok: true, json: async () => ({ id: 'co_test_1' }) }
  }
  throw new Error(`Unexpected Stripe endpoint ${target}`)
})

/** Stripe calls the handler made, by endpoint. */
function stripeCalls(endpoint: string) {
  return fetchMock.mock.calls.filter((call) =>
    String(call[0]).endsWith(endpoint),
  ).length
}

// ---------------------------------------------------------------------------
// Request / response plumbing
// ---------------------------------------------------------------------------

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

interface Scenario {
  /** What the shopper declared, exactly as it arrives over the wire. */
  shippingCountry?: unknown
  couponCode?: string
  /** Overrides on the single cart product. */
  product?: Record<string, any>
  /**
   * `hosts/{hostId}/discounts` docs. When present the legacy AGL-96 coupon is
   * NOT seeded, so a scenario testing a discount cannot accidentally be
   * carried by a 50%-off coupon of the same code if the discount fails to
   * resolve — which would hide the very failure under test.
   */
  discounts?: Array<Record<string, any> & { id: string }>
  /**
   * A SECOND product in the cart, so a scoped discount has something to NOT
   * cover. With one product the scoped and unscoped answers coincide and the
   * assertion proves nothing.
   */
  extraProduct?: { id: string; priceUsd: number; quantity: number }
  /** The offers the buyer ticked, as the cart sends them. */
  extras?: unknown
  /** A rewards or referral code, as typed. */
  creditCode?: string
  email?: string
}

function makeRequest(scenario: Scenario): PluginApiRequest {
  return {
    method: 'POST',
    body: {
      hostId: 'host-1',
      ...(scenario.couponCode ? { couponCode: scenario.couponCode } : {}),
      ...(scenario.extras !== undefined ? { extras: scenario.extras } : {}),
      ...(scenario.creditCode !== undefined ? { creditCode: scenario.creditCode } : {}),
      ...(scenario.email ? { email: scenario.email } : {}),
      ...('shippingCountry' in scenario
        ? { shippingCountry: scenario.shippingCountry }
        : {}),
    },
    cookies: { 'aglyn_cart_host-1': 'cart-1' },
    headers: { host: 'shop.example.com' },
    query: {},
  } as unknown as PluginApiRequest
}

/** Seeds a host that can sell, with one 800g $60 item in the cart. */
function seedStore(
  storeSettings: Record<string, any> | null,
  scenario: Scenario,
) {
  docs.clear()
  docs.set('hosts/host-1/carts/cart-1', {
    lines: [{ productId: 'p1', variantId: 'v1', quantity: 2 }],
  })
  docs.set('profiles/owner-1', {
    stripeAccountId: 'acct_1',
    stripeChargesEnabled: true,
  })
  docs.set('hosts/host-1/products/p1', {
    name: 'Kettle',
    status: 'active',
    type: 'physical',
    variants: [{ id: 'v1', priceUsd: 30, weightGrams: 400, inventory: 10 }],
    ...(scenario.product ?? {}),
  })
  // AGL-1999: every scenario in this suite is about SHIPPING, so the store
  // states a tax decision it would otherwise leave unmade — an undecided
  // store refuses the sale before shipping is ever resolved. A scenario that
  // supplies its own `tax` wins.
  docs.set('hosts/host-1/settings/store', {
    tax: { mode: 'none' },
    ...(storeSettings ?? {}),
  })
  if (scenario.extraProduct) {
    const extra = scenario.extraProduct
    const cart = docs.get('hosts/host-1/carts/cart-1') as any
    cart.lines = [
      ...cart.lines,
      { productId: extra.id, variantId: `${extra.id}-v1`, quantity: extra.quantity },
    ]
    docs.set(`hosts/host-1/products/${extra.id}`, {
      name: extra.id,
      status: 'active',
      type: 'physical',
      variants: [
        { id: `${extra.id}-v1`, priceUsd: extra.priceUsd, weightGrams: 10, inventory: 10 },
      ],
    })
  }
  for (const discount of scenario.discounts ?? []) {
    const { id, ...fields } = discount
    docs.set(`hosts/host-1/discounts/${id}`, fields)
  }
  if (scenario.couponCode && !scenario.discounts) {
    docs.set(`hosts/host-1/coupons/${scenario.couponCode}`, {
      percentOff: 50,
      enabled: true,
    })
  }
}

async function runCheckout(
  storeSettings: Record<string, any> | null,
  scenario: Scenario = {},
) {
  seedStore(storeSettings, scenario)
  sessionBody = null
  const { res, result } = makeResponse()
  await cartCheckoutHandler(makeRequest(scenario), res)
  return { result, body: sessionBody as URLSearchParams | null }
}

// ---------------------------------------------------------------------------
// A recording provider
// ---------------------------------------------------------------------------

const calls: Array<[string, Record<string, unknown>]> = []

function provide(overrides: Partial<PluginCheckoutCreditProvider> = {}) {
  registerPluginCheckoutCredit(
    {
      key: 'rewards',
      label: 'Rewards',
      recognizes: (code) => code.startsWith('RW-'),
      offered: async (input) => {
        calls.push(['offered', input])
        return true
      },
      resolve: async (input) => {
        calls.push(['resolve', input])
        return { ok: true, reference: 'm:abc', label: 'Rewards', last4: 'CCCC', availableCents: 1_500 }
      },
      hold: async (input) => {
        calls.push(['hold', input as unknown as Record<string, unknown>])
        return { ok: true, cents: Math.min(1_500, input.maxCents) }
      },
      release: async (input) => {
        calls.push(['release', input])
      },
      stage: async () => null,
      restore: async () => 0,
      ...overrides,
    },
    { pluginId: 'loyalty' },
  )
}

const named = (name: string) => calls.filter(([call]) => call === name).map(([, input]) => input)

describe('cart checkout store credit (AGL-3640)', () => {
  const realFetch = global.fetch
  const realKey = process.env.STRIPE_SECRET_KEY

  beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_never_used'
  })

  afterAll(() => {
    global.fetch = realFetch
    process.env.STRIPE_SECRET_KEY = realKey as string
  })

  beforeEach(() => {
    fetchMock.mockClear()
    couponAmounts.length = 0
    calls.length = 0
    couponFails = false
    resetPluginServicesForTests()
  })

  it('sells exactly as before with no code', async () => {
    provide()
    const { result, body } = await runCheckout(null)
    expect(result.status).toBe(200)
    expect(body?.has('metadata[credit0]')).toBe(false)
    expect(couponAmounts).toEqual([])
    expect(calls).toEqual([])
  })

  it('holds the code’s credit against the goods, joins it to the one coupon, and carries the hold — not the code', async () => {
    provide()
    const { result, body } = await runCheckout(null, { creditCode: ' rw-aaaa-bbbb-cccc ', email: 'Pat@Example.com' })
    expect(result.status).toBe(200)
    expect(named('resolve')).toEqual([
      { hostId: 'host-1', code: 'RW-AAAA-BBBB-CCCC', channel: 'online', customerEmail: 'pat@example.com', staff: false },
    ])
    expect(named('hold')[0]).toMatchObject({ hostId: 'host-1', reference: 'm:abc', maxCents: 6_000, currency: 'usd' })
    expect(couponAmounts).toEqual(['1500'])
    expect(body?.get('discounts[0][coupon]')).toBe('co_test_1')
    const held = decodeCheckoutCreditMetadata(Object.fromEntries([...(body?.entries() ?? [])].map(([key, value]) => [key.replace(/^metadata\[|\]$/g, ''), value])))
    expect(held).toMatchObject({ providerId: 'loyalty.rewards', reference: 'm:abc', amountCents: 1_500, label: 'Rewards', last4: 'CCCC' })
    expect(held?.holdKey).toBe(named('hold')[0]['holdKey'])
    expect(String(body?.get('metadata[credit0]'))).not.toContain('RW-')
    expect(named('release')).toEqual([])
  })

  it('holds only what is left after a coupon', async () => {
    provide()
    const { result } = await runCheckout(null, { creditCode: 'RW-AAAA-BBBB-CCCC', couponCode: 'HALF' })
    expect(result.status).toBe(200)
    expect(named('hold')[0]).toMatchObject({ maxCents: 3_000 })
    expect(couponAmounts).toEqual(['4500'])
  })

  it('refuses a code no provider takes, before Stripe is asked', async () => {
    const { result } = await runCheckout(null, { creditCode: 'RW-AAAA-BBBB-CCCC' })
    expect(result).toEqual({ status: 400, body: { error: CHECKOUT_CREDIT_INVALID_MESSAGE, creditCodeInvalid: true } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses where the site does not offer it', async () => {
    provide({ offered: async () => false })
    const { result } = await runCheckout(null, { creditCode: 'RW-AAAA-BBBB-CCCC' })
    expect(result.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes the provider’s refusal on, in its words, and holds nothing', async () => {
    provide({ resolve: async () => ({ ok: false, status: 409, error: 'A referral code is for a first order.' }) })
    const { result } = await runCheckout(null, { creditCode: 'RW-AAAA-BBBB-CCCC' })
    expect(result).toEqual({ status: 409, body: { error: 'A referral code is for a first order.', creditCodeInvalid: true } })
    expect(named('hold')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a hold that fails is a refusal, and a provider that throws is one too', async () => {
    provide({ hold: async () => ({ ok: false, status: 409, error: 'This rewards account has nothing to spend right now.' }) })
    expect((await runCheckout(null, { creditCode: 'RW-AAAA-BBBB-CCCC' })).result.status).toBe(409)
    resetPluginServicesForTests()
    provide({
      hold: async () => {
        throw new Error('boom')
      },
    })
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await runCheckout(null, { creditCode: 'RW-AAAA-BBBB-CCCC' })).result.status).toBe(409)
    spy.mockRestore()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a coupon Stripe will not mint refuses the sale and lets the hold go', async () => {
    provide()
    couponFails = true
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { result } = await runCheckout(null, { creditCode: 'RW-AAAA-BBBB-CCCC' })
    spy.mockRestore()
    expect(result).toEqual({ status: 502, body: { error: 'Checkout failed' } })
    expect(named('release')).toEqual([{ hostId: 'host-1', reference: 'm:abc', holdKey: named('hold')[0]['holdKey'] }])
    expect(stripeCalls('/v1/checkout/sessions')).toBe(0)
  })

  it('a provider that gives nothing adds nothing and keeps no hold', async () => {
    provide({ hold: async () => ({ ok: true, cents: 0 }) })
    const { result, body } = await runCheckout(null, { creditCode: 'RW-AAAA-BBBB-CCCC' })
    expect(result.status).toBe(200)
    expect(body?.has('metadata[credit0]')).toBe(false)
    expect(named('release')).toHaveLength(1)
  })
})

describe('the cart learns which codes it may take', () => {
  beforeEach(() => resetPluginServicesForTests())

  it('names each offered provider, and nothing when none is registered', async () => {
    const ask = async () => {
      const { res, result } = makeResponse()
      await cartExtrasHandler(
        { method: 'GET', query: { hostId: 'host-1' }, cookies: {}, headers: {} } as unknown as PluginApiRequest,
        res,
      )
      return result
    }
    expect((await ask()).body).toEqual({ extras: [], credits: [] })
    provide()
    expect((await ask()).body).toEqual({ extras: [], credits: [{ providerId: 'loyalty.rewards', label: 'Rewards' }] })
  })
})
