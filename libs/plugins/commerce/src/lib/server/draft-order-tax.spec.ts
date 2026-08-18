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

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { draftOrderHandler } from './draft-order'

/**
 * A draft order charges tax (AGL-1953).
 *
 * `draft-order.ts` contained no tax code in EITHER mode — the same shape
 * AGL-1792 found for shipping, one field over. A merchant who configured tax
 * collected it on the storefront and collected nothing when they invoiced the
 * same buyer for the same product through a payment link. Worse than the
 * cart's version of this defect in one respect: the merchant composed this
 * order deliberately and would reasonably assume it matched their store.
 *
 * Two things are proved here that the model specs cannot: that the settings
 * document is actually read, and that the resulting figure reaches BOTH the
 * Stripe session (so the buyer is charged it) and the frozen order totals (so
 * the merchant's books show it). A handler that did one and not the other
 * would look right from whichever side you checked first.
 *
 * Stripe is mocked absolutely: nothing here may reach api.stripe.com.
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
    // `merge` keeps the fields it is not given; a plain `set` replaces the
    // document. Modelling only one would let a test pass against a handler
    // that used the wrong one.
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
  return {
    doc: (id?: string) =>
      makeDocRef(`${path}/${id ?? `auto-${++autoIdCounter}`}`),
    get: async () => ({
      docs: childPaths(path).map(makeSnapshot),
      size: childPaths(path).length,
    }),
  }
}

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
  runTransaction: async (fn: (transaction: any) => Promise<any>) =>
    fn({
      get: (ref: any) => ref.get(),
      set: (ref: any, value: any, options?: any) => {
        void ref.set(value, options)
      },
    }),
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
    app: () => ({
      firestore: () => fakeFirestore,
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'mgr-1', email: 'mgr@acme.test' }),
      }),
    }),
    firestore: {
      FieldValue: { serverTimestamp: () => '<server-timestamp>' },
    },
  },
  getOrgForHost: async () => mockOrg,
}))

// ---------------------------------------------------------------------------
// Stripe boundary — captured, never reached
// ---------------------------------------------------------------------------

let sessionBody: URLSearchParams | null = null
let taxRateRefuses = false

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
  if (target.endsWith('/v1/tax_rates')) {
    if (taxRateRefuses) {
      return { ok: false, json: async () => ({ error: { message: 'nope' } }) }
    }
    return { ok: true, json: async () => ({ id: 'txr_draft_1' }) }
  }
  throw new Error(`Unexpected Stripe endpoint ${target}`)
})

function stripeCalls(endpoint: string) {
  return fetchMock.mock.calls.filter((call) =>
    String(call[0]).endsWith(endpoint),
  ).length
}

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

/** 8.25% Texas, origin Texas — 2 × $30.00 taxes to 495 cents. */
const MANUAL_TX = {
  tax: {
    mode: 'manual',
    origin: { country: 'US', state: 'TX' },
    rates: [{ country: 'US', state: 'TX', pct: 8.25, label: 'TX sales tax' }],
  },
}

interface Scenario {
  settings?: Record<string, any> | null
  product?: Record<string, any>
}

async function runDraft(scenario: Scenario = {}) {
  docs.clear()
  autoIdCounter = 0
  sessionBody = null
  docs.set('hosts/host-1', {
    name: 'Acme',
    memberRoles: { 'mgr-1': 'manager' },
  })
  docs.set('hostIndex/host-1', { subdomain: 'acme' })
  docs.set('profiles/owner-1', {
    stripeAccountId: 'acct_1',
    stripeChargesEnabled: true,
  })
  docs.set('hosts/host-1/products/p1', {
    name: 'Kettle',
    status: 'active',
    // Digital, so the shipping planner stays out of the way of the assertions.
    type: 'digital',
    variants: [{ id: 'v1', priceUsd: 30, inventory: 100 }],
    ...(scenario.product ?? {}),
  })
  if (scenario.settings) {
    docs.set('hosts/host-1/settings/store', scenario.settings)
  }
  const { res, result } = makeResponse()
  await draftOrderHandler(
    {
      method: 'POST',
      body: {
        hostId: 'host-1',
        productId: 'p1',
        variantId: 'v1',
        quantity: 2,
        email: 'buyer@example.com',
      },
      cookies: {},
      headers: { host: 'console.example.com', authorization: 'Bearer id-token' },
      query: {},
    } as unknown as PluginApiRequest,
    res,
  )
  return { result, body: sessionBody as URLSearchParams | null }
}

/** The single order document this handler writes. */
function orderDoc() {
  return childPaths('hosts/host-1/orders').map((path) => docs.get(path))[0]
}

const ORIGINAL_STRIPE_KEY = process.env.STRIPE_SECRET_KEY

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

afterAll(() => {
  if (ORIGINAL_STRIPE_KEY === undefined) delete process.env.STRIPE_SECRET_KEY
  else process.env.STRIPE_SECRET_KEY = ORIGINAL_STRIPE_KEY
})

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_double_1953'
  taxRateRefuses = false
  fetchMock.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ---------------------------------------------------------------------------

describe('a manual-tax store taxes its draft orders (AGL-1953)', () => {
  /** THE DEFECT: this payment link used to carry no tax at all. */
  it('puts the merchant configured rate on the line', async () => {
    const { result, body } = await runDraft({ settings: MANUAL_TX })
    expect(result.status).toBe(200)
    expect(stripeCalls('/v1/tax_rates')).toBe(1)
    expect(body?.get('line_items[0][tax_rates][0]')).toBe('txr_draft_1')
    // The classification flag stays off — this is the merchant's own rate,
    // not Stripe Tax computing against Aglyn's registrations (AGL-1904).
    expect(body?.get('automatic_tax[enabled]')).toBeNull()
  })

  /**
   * BOTH sides, asserted separately. The buyer is charged it (above) and the
   * merchant's frozen order says so (here) — a handler that did one only
   * would read as correct from whichever side was checked first.
   *
   * 8.25% of 2 × $30.00 is 495 cents, a figure no other total in this file
   * shares (AGL-1711's rule).
   */
  it('freezes the tax onto the order totals too', async () => {
    await runDraft({ settings: MANUAL_TX })
    expect(orderDoc()?.totals?.taxCents).toBe(495)
    expect(orderDoc()?.totals?.itemsCents).toBe(6000)
    expect(orderDoc()?.totals?.totalCents).toBe(6495)
  })

  /** A tax-exempt product is not taxed, on this path as on the others. */
  it('leaves a tax-exempt product alone', async () => {
    const { body } = await runDraft({
      settings: MANUAL_TX,
      product: { taxExempt: true },
    })
    expect(body?.get('line_items[0][tax_rates][0]')).toBeNull()
    expect(orderDoc()?.totals?.taxCents ?? 0).toBe(0)
    expect(stripeCalls('/v1/tax_rates')).toBe(0)
  })

  /**
   * A VISIBLE refusal, and — peculiar to this path — no stranded order. The
   * handler writes its order BEFORE it talks to Stripe, so a refusal that
   * skipped the rollback would leave a `pending` draft on the merchant's list
   * for every attempt (AGL-1792's constraint, inherited).
   */
  it('refuses and strands no order when Stripe will not mint the rate', async () => {
    taxRateRefuses = true
    const { result } = await runDraft({ settings: MANUAL_TX })
    expect(result.status).toBe(502)
    expect(stripeCalls('/v1/checkout/sessions')).toBe(0)
    expect(childPaths('hosts/host-1/orders')).toHaveLength(0)
  })
})

describe('the other tax modes on a draft order', () => {
  it('asks Stripe Tax to compute a `stripe` mode store', async () => {
    const { body } = await runDraft({ settings: { tax: { mode: 'stripe' } } })
    expect(body?.get('automatic_tax[enabled]')).toBe('true')
    // Stripe computes its own; minting one here would tax the buyer twice.
    expect(stripeCalls('/v1/tax_rates')).toBe(0)
    expect(body?.get('line_items[0][tax_rates][0]')).toBeNull()
    // The figure is not known at composition time, so the frozen totals say
    // nothing and the webhook folds Stripe's own in.
    expect(orderDoc()?.totals?.taxCents ?? 0).toBe(0)
  })

  /** A merchant who configured nothing gets the link they always got. */
  it('sends no tax of any kind when none is configured', async () => {
    const { body } = await runDraft({ settings: null })
    expect(body?.get('automatic_tax[enabled]')).toBeNull()
    expect(body?.get('line_items[0][tax_rates][0]')).toBeNull()
    expect(stripeCalls('/v1/tax_rates')).toBe(0)
    expect(orderDoc()?.totals?.taxCents ?? 0).toBe(0)
  })

  /** Tax already inside the price: adding a rate would charge it twice. */
  it('adds nothing when prices already include tax', async () => {
    const { body } = await runDraft({
      settings: { tax: { ...MANUAL_TX.tax, pricesIncludeTax: true } },
    })
    expect(body?.get('line_items[0][tax_rates][0]')).toBeNull()
    expect(orderDoc()?.totals?.taxCents ?? 0).toBe(0)
  })
})
