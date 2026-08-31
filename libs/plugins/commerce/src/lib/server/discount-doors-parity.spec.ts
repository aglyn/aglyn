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

/**
 * ONE CODE, ONE PRICE, WHICHEVER DOOR THE SHOPPER CAME THROUGH (AGL-305).
 *
 * `hosts/{hostId}/discounts` reached the cart (AGL-305) and then buy-now and
 * stopped there. The draft-order payment link and the register read
 * the collection not at all, so the same goods cost different money depending
 * on which button was pressed — and no code had to be typed for the gap to
 * open, because an automatic promotion applies itself on the storefront and
 * applied itself nowhere else.
 *
 * ## What is asserted, and why it is the charged amount
 *
 * Every assertion in this file reads what the buyer is CHARGED — the Stripe
 * line amount, or the stored `totals` a cash sale is settled against — never a
 * rendered price or a resolver's return value. A door can resolve a discount
 * perfectly and still charge full price; that gap is the entire defect this
 * suite exists for, and only the charge closes it.
 *
 * ## The tax position under test
 *
 * The discount lands BEFORE tax on every door here, and the fixture is built
 * so that the two readings are different numbers: $100 of goods, 10% off, a
 * 10% manual rate. Tax on the discounted base is 900¢; tax on the list price
 * would be 1000¢. An implementation that discounted after tax passes no
 * assertion in this file.
 *
 * ## Stripe
 *
 * Absolutely mocked. `fetch` throws on any host but `api.stripe.com`, no
 * secret key beyond a test-mode placeholder is ever set, and every session
 * body is captured rather than sent.
 */

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { checkoutHandler } from './checkout'
import { draftOrderHandler } from './draft-order'
import { posOrderHandler } from './pos-order'

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
let autoIdCounter = 0
const DELETE = Symbol('delete')

function childPaths(prefix: string): string[] {
  return [...docs.keys()].filter(
    (key) =>
      key.startsWith(`${prefix}/`) &&
      !key.slice(prefix.length + 1).includes('/'),
  )
}

function makeSnapshot(path: string): any {
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
      const next = options?.merge
        ? { ...(docs.get(path) ?? {}), ...value }
        : { ...value }
      // The delete sentinel, honoured one level deep — which is where
      // `promotion-hold.ts` writes it (`holds: { [key]: delete() }`). A double
      // that stored the sentinel as a value would leave a settled hold
      // standing and make the redemption assertions below meaningless.
      if (next['holds'] && typeof next['holds'] === 'object') {
        const merged: Record<string, any> = {
          ...((options?.merge ? docs.get(path)?.['holds'] : undefined) ?? {}),
          ...next['holds'],
        }
        for (const [key, value] of Object.entries(merged)) {
          if (value === DELETE) delete merged[key]
        }
        next['holds'] = merged
      }
      if (next['redemptions']?.__increment != null) {
        next['redemptions'] =
          Number(docs.get(path)?.['redemptions'] ?? 0) +
          Number(next['redemptions'].__increment)
      }
      docs.set(path, next)
    },
    /**
     * `create()` rejects on an existing document, and that rejection IS the
     * dedupe primitive `claimAttempt` is built on. A double without it 409s
     * every call and would report this whole file green for the wrong reason.
     */
    create: async (value: Record<string, any>) => {
      if (docs.has(path)) {
        throw Object.assign(
          new Error(`ALREADY_EXISTS: ${path}`),
          { code: 6 },
        )
      }
      docs.set(path, value)
    },
    update: async (value: Record<string, any>) => {
      if (!docs.has(path)) {
        throw Object.assign(new Error(`NOT_FOUND: ${path}`), { code: 5 })
      }
      docs.set(path, { ...(docs.get(path) ?? {}), ...value })
    },
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  const ref: any = {
    doc: (id?: string) =>
      makeDocRef(`${path}/${id ?? `auto-${++autoIdCounter}`}`),
    get: async () => ({
      docs: childPaths(path).map(makeSnapshot),
      size: childPaths(path).length,
    }),
    add: async (value: Record<string, any>) => {
      const created = makeDocRef(`${path}/auto-${++autoIdCounter}`)
      docs.set(created.path, value)
      return created
    },
    where: () => ref,
    orderBy: () => ref,
    limit: () => ref,
  }
  return ref
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
  orgId: 'org-1',
  org: {
    id: 'org-1',
    plan: 'business',
    subscriptionStatus: 'active',
    ownerUid: 'owner-1',
    slug: 'acme',
  },
}

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  ...jest.requireActual('@aglyn/tenant-runtime/org-permissions'),
  resolveOrgPermissions: async () => ({
    orgId: 'org-1',
    role: 'admin',
    isOwner: true,
    permissions: { managePos: true } as Record<string, boolean>,
    orgWide: true,
    hostRole: 'admin',
  }),
}))

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
    app: () => ({
      firestore: () => fakeFirestore,
      auth: () => ({
        verifyIdToken: async () => ({
          uid: 'mgr-1',
          email: 'mgr@acme.test',
        }),
      }),
    }),
    firestore: {
      FieldValue: {
        delete: () => DELETE,
        serverTimestamp: () => '<server-timestamp>',
        increment: (value: number) => ({ __increment: value }),
        arrayUnion: (value: any) => ({ __arrayUnion: value }),
      },
    },
  },
  getOrgForHost: async () => mockOrg,
  getPluginConfig: async () => ({}),
  notifyHostManagers: async () => undefined,
  upsertHostContact: async () => undefined,
}))

// ---------------------------------------------------------------------------
// Stripe boundary — captured, never reached
// ---------------------------------------------------------------------------

let sessionBody: URLSearchParams | null = null

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
    return { ok: true, json: async () => ({ id: 'txr_1' }) }
  }
  throw new Error(`Unexpected Stripe endpoint ${target}`)
})

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

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/**
 * $100 a unit, DIGITAL so no shipping planner stands between the discount and
 * the assertion, and a 10% manual rate. The three figures are deliberately
 * distinct: 10000 list, 9000 charged, 900 tax — and 1000 would be the tax an
 * implementation that discounted AFTER tax charged.
 */
const PRICE_USD = 100
const LIST_CENTS = 10_000
const DISCOUNTED_CENTS = 9_000
const TAX_ON_DISCOUNTED = 900

const MANUAL_TEN_PCT = {
  tax: {
    mode: 'manual',
    origin: { country: 'US', state: 'TX' },
    rates: [{ country: 'US', state: 'TX', pct: 10, label: 'TX tax' }],
  },
}

/** A plain 10%-off code, entered by whoever is standing at the door. */
const TEN_OFF = {
  code: 'TENOFF',
  kind: 'percent',
  valuePct: 10,
  enabled: true,
}

interface StoreOptions {
  settings?: Record<string, any>
  discount?: Record<string, any> | null
  /** A second product, for the scoping case. */
  second?: boolean
}

function seedStore(options: StoreOptions = {}) {
  docs.clear()
  autoIdCounter = 0
  sessionBody = null
  docs.set('hosts/host-1', {
    name: 'Acme',
    memberRoles: { 'mgr-1': 'editor' },
  })
  docs.set('hostIndex/host-1', { subdomain: 'acme' })
  docs.set('profiles/owner-1', {
    stripeAccountId: 'acct_1',
    stripeChargesEnabled: true,
  })
  docs.set('hosts/host-1/registers/register-1', {
    name: 'Front counter',
    createdAt: { toMillis: () => 1000 },
  })
  docs.set('hosts/host-1/products/p1', {
    name: 'Kettle',
    status: 'active',
    type: 'digital',
    variants: [{ id: 'v1', priceUsd: PRICE_USD, inventory: 100 }],
  })
  if (options.second) {
    docs.set('hosts/host-1/products/p2', {
      name: 'Grinder',
      status: 'active',
      type: 'digital',
      variants: [{ id: 'v1', priceUsd: PRICE_USD, inventory: 100 }],
    })
  }
  docs.set('hosts/host-1/settings/store', options.settings ?? { tax: { mode: 'none' } })
  if (options.discount) {
    const { id, ...fields } = options.discount as any
    docs.set(`hosts/host-1/discounts/${id ?? 'ten'}`, fields)
  }
}

// ---------------------------------------------------------------------------
// The three doors
// ---------------------------------------------------------------------------

/** Buy now — the door that already resolves through the hub. */
async function buyNow(couponCode?: string) {
  const { res, result } = makeResponse()
  await checkoutHandler(
    {
      method: 'POST',
      body: {
        hostId: 'host-1',
        productId: 'p1',
        variantId: 'v1',
        quantity: 1,
        ...(couponCode ? { couponCode } : {}),
      },
      cookies: {},
      headers: { host: 'shop.example.com' },
      query: {},
    } as unknown as PluginApiRequest,
    res,
  )
  return { result, body: sessionBody as URLSearchParams | null }
}

/** The merchant's payment link. */
async function draftOrder(couponCode?: string, quantity = 1) {
  const { res, result } = makeResponse()
  await draftOrderHandler(
    {
      method: 'POST',
      body: {
        hostId: 'host-1',
        productId: 'p1',
        variantId: 'v1',
        quantity,
        email: 'buyer@example.com',
        ...(couponCode ? { couponCode } : {}),
      },
      cookies: {},
      headers: {
        host: 'console.example.com',
        authorization: 'Bearer id-token',
        'idempotency-key': `draft-${++autoIdCounter}`,
      },
      query: {},
    } as unknown as PluginApiRequest,
    res,
  )
  return { result, body: sessionBody as URLSearchParams | null }
}

/** The register, cash tender — settled on the spot, no webhook. */
async function ring(
  couponCode?: string,
  extra: Record<string, unknown> = {},
) {
  const { res, result } = makeResponse()
  await posOrderHandler(
    {
      method: 'POST',
      body: {
        hostId: 'host-1',
        payment: 'cash',
        cashReceivedCents: 100_000,
        registerId: 'register-1',
        lines: [{ productId: 'p1', variantId: 'v1', quantity: 1 }],
        ...(couponCode ? { couponCode } : {}),
        ...extra,
      },
      cookies: {},
      headers: {
        authorization: 'Bearer id-token',
        'idempotency-key': `pos-${++autoIdCounter}`,
      },
      query: {},
    } as unknown as PluginApiRequest,
    res,
  )
  return result
}

/** What a captured session actually charges for goods. */
function chargedGoodsCents(body: URLSearchParams | null): number {
  const unit = Number(body?.get('line_items[0][price_data][unit_amount]') ?? 0)
  const quantity = Number(body?.get('line_items[0][quantity]') ?? 0)
  return unit * quantity
}

/** The one order document a door wrote. */
function orderDoc(): any {
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
  // Test mode, and nothing reaches Stripe regardless — `fetchMock` throws on
  // any other host and returns canned objects for the two endpoints used.
  process.env.STRIPE_SECRET_KEY = 'sk_test_doors_2520'
  fetchMock.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ---------------------------------------------------------------------------

describe('the premise still holds', () => {
  /**
   * Without this, every "the discount applied" assertion below could be green
   * because the door refused, wrote nothing, and charged nothing.
   */
  it('all three doors sell the undiscounted product for the list price', async () => {
    seedStore()
    const bought = await buyNow()
    expect(bought.result.status).toBe(200)
    expect(chargedGoodsCents(bought.body)).toBe(LIST_CENTS)

    seedStore()
    const drafted = await draftOrder()
    expect(drafted.result.status).toBe(200)
    expect(chargedGoodsCents(drafted.body)).toBe(LIST_CENTS)

    seedStore()
    const rung = await ring()
    expect(rung.status).toBe(200)
    expect(rung.body.totals.totalCents).toBe(LIST_CENTS)
  })

  it('the fixture discount is actually stored where the doors read it', async () => {
    seedStore({ discount: { id: 'ten', ...TEN_OFF } })
    // A scoping typo here would leave the collection empty and every door
    // would charge full price for the RIGHT reason, reporting the defect this
    // suite exists to catch as a pass.
    expect(docs.get('hosts/host-1/discounts/ten')).toMatchObject({
      code: 'TENOFF',
      valuePct: 10,
    })
  })
})

describe('the draft-order payment link applies the discount (AGL-305)', () => {
  /** THE DEFECT: this link used to be minted at the list price. */
  it('charges the discounted goods, not the list price', async () => {
    seedStore({ discount: { id: 'ten', ...TEN_OFF } })
    const { result, body } = await draftOrder('TENOFF')

    expect(result.status).toBe(200)
    expect(chargedGoodsCents(body)).toBe(DISCOUNTED_CENTS)
    // And the merchant's own frozen record agrees with the link.
    expect(orderDoc().totals.discountCents).toBe(LIST_CENTS - DISCOUNTED_CENTS)
    expect(orderDoc().totals.totalCents).toBe(DISCOUNTED_CENTS)
  })

  it('an AUTOMATIC promotion applies with no code typed at all', async () => {
    // The gap that needed no shopper to open it: a store-wide sale reached the
    // storefront and never reached the merchant's own payment link.
    seedStore({
      discount: { id: 'summer', name: 'Summer sale', kind: 'percent', valuePct: 10, enabled: true },
    })
    const { result, body } = await draftOrder()

    expect(result.status).toBe(200)
    expect(chargedGoodsCents(body)).toBe(DISCOUNTED_CENTS)
  })

  it('taxes the DISCOUNTED base, so the discount lands before tax', async () => {
    seedStore({
      settings: MANUAL_TEN_PCT,
      discount: { id: 'ten', ...TEN_OFF },
    })
    const { result, body } = await draftOrder('TENOFF')

    expect(result.status).toBe(200)
    expect(chargedGoodsCents(body)).toBe(DISCOUNTED_CENTS)
    // 900, not 1000. The tax rides as `line_items[0][tax_rates][0]`, which
    // Stripe evaluates against the line it actually charges — so a stored
    // figure computed on the list price would be a number Stripe never takes.
    expect(orderDoc().totals.taxCents).toBe(TAX_ON_DISCOUNTED)
    expect(body?.get('line_items[0][tax_rates][0]')).toBe('txr_1')
  })

  it('refuses an unusable code with a reason, and mints nothing', async () => {
    seedStore({
      discount: { id: 'ten', ...TEN_OFF, enabled: false },
    })
    const { result } = await draftOrder('TENOFF')

    expect(result.status).toBe(400)
    expect(String(result.body.error)).toContain('disabled')
    // BEFORE anything is charged: no session, and no `pending` order stranded
    // on the merchant's list.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(childPaths('hosts/host-1/orders')).toHaveLength(0)
  })

  it('refuses a code that resolves but is worth nothing here', async () => {
    // The free-shipping shape, one door over: a benefit that resolves cleanly
    // and confers nothing. `productIds` with no line detail is the same class
    // of "resolvable, unpriceable" and must leave through a refusal rather
    // than as a successful discount of zero.
    seedStore({
      discount: { id: 'ten', ...TEN_OFF, valuePct: 0 },
    })
    const { result } = await draftOrder('TENOFF')

    expect(result.status).toBe(400)
    expect(String(result.body.error)).toContain('takes nothing off')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a scoped discount does not reach a product outside its scope', async () => {
    seedStore({
      second: true,
      discount: { id: 'ten', ...TEN_OFF, productIds: ['p2'] },
    })
    // The draft is for p1; the discount names p2 only.
    const { result } = await draftOrder('TENOFF')

    expect(result.status).toBe(400)
    expect(String(result.body.error)).toContain('does not apply')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a multi-quantity discount charges the exact total, not a rounded unit', async () => {
    // 3 × $100 less 10% is 27000, which divides evenly. Make it not: 7% of
    // 30000 is 2100 → 27900, and 27900 / 3 = 9300 exactly. Use a quantity that
    // forces a remainder instead.
    seedStore({
      discount: { id: 'odd', code: 'ODD', kind: 'percent', valuePct: 7, enabled: true },
    })
    const { result, body } = await draftOrder('ODD', 7)
    const listCents = LIST_CENTS * 7
    const expected = listCents - Math.round((listCents * 7) / 100)

    expect(result.status).toBe(200)
    // The line collapses to one unit at the exact total when it cannot divide.
    expect(chargedGoodsCents(body)).toBe(expected)
    expect(orderDoc().totals.totalCents).toBe(expected)
  })
})

describe('the register applies the discount (AGL-305)', () => {
  /** THE DEFECT: the till knew only the cashier's own percentage. */
  it('charges the discounted total on a cash sale', async () => {
    seedStore({ discount: { id: 'ten', ...TEN_OFF } })
    const result = await ring('TENOFF')

    expect(result.status).toBe(200)
    expect(result.body.totals.discountCents).toBe(LIST_CENTS - DISCOUNTED_CENTS)
    expect(result.body.totals.totalCents).toBe(DISCOUNTED_CENTS)
    expect(orderDoc().discountId).toBe('ten')
  })

  it('taxes the DISCOUNTED base, so the discount lands before tax', async () => {
    seedStore({
      settings: MANUAL_TEN_PCT,
      discount: { id: 'ten', ...TEN_OFF },
    })
    const result = await ring('TENOFF')

    expect(result.status).toBe(200)
    expect(result.body.totals.taxCents).toBe(TAX_ON_DISCOUNTED)
    expect(result.body.totals.totalCents).toBe(
      DISCOUNTED_CENTS + TAX_ON_DISCOUNTED,
    )
  })

  it('stacks with the cashier’s own discount without double-counting', async () => {
    // Two different mechanisms — the merchant's promotion and the operator's
    // discretion — and both come off the same basket exactly once.
    seedStore({ discount: { id: 'ten', ...TEN_OFF } })
    const result = await ring('TENOFF', { discountPct: 20 })

    expect(result.status).toBe(200)
    // 20% of the list (2000) plus the hub's 10% (1000).
    expect(result.body.totals.discountCents).toBe(3_000)
    expect(result.body.totals.totalCents).toBe(7_000)
  })

  it('refuses a free-shipping code rather than ringing full price', async () => {
    // Resolvable, and worth nothing at a till — there is no carriage to zero.
    // Falling through would charge the shopper in full while they held a valid
    // code, which is the exact shape of the defect that charged $7.99 for free
    // shipping.
    seedStore({
      discount: { id: 'ship', code: 'FREESHIP', kind: 'free_shipping', enabled: true },
    })
    const result = await ring('FREESHIP')

    expect(result.status).toBe(400)
    expect(String(result.body.error)).toContain('nothing to ship')
    expect(childPaths('hosts/host-1/orders')).toHaveLength(0)
  })

  it('refuses an unusable code with a reason, and rings nothing', async () => {
    seedStore({ discount: { id: 'ten', ...TEN_OFF, enabled: false } })
    const result = await ring('TENOFF')

    expect(result.status).toBe(400)
    expect(String(result.body.error)).toContain('disabled')
    expect(childPaths('hosts/host-1/orders')).toHaveLength(0)
  })

  it('a scoped discount prices only the lines in scope', async () => {
    // Two $100 lines, the discount scoped to one of them. 10% of ONE line is
    // 1000 — not 2000, which is what pricing the scope against the whole
    // basket would take.
    seedStore({
      second: true,
      discount: { id: 'ten', ...TEN_OFF, productIds: ['p1'] },
    })
    const result = await ring('TENOFF', {
      lines: [
        { productId: 'p1', variantId: 'v1', quantity: 1 },
        { productId: 'p2', variantId: 'v1', quantity: 1 },
      ],
    })

    expect(result.status).toBe(200)
    expect(result.body.totals.itemsCents).toBe(LIST_CENTS * 2)
    expect(result.body.totals.discountCents).toBe(1_000)
    expect(result.body.totals.totalCents).toBe(19_000)
  })

  it('counts the redemption on the spot, because no webhook is coming', async () => {
    // A cash sale is complete when the document is written. Without an inline
    // settlement a capped promotion would be bounded on the website and
    // unbounded at the counter.
    seedStore({
      discount: { id: 'ten', ...TEN_OFF, maxRedemptions: 5 },
    })
    const result = await ring('TENOFF')

    expect(result.status).toBe(200)
    expect(docs.get('hosts/host-1/discounts/ten')?.['redemptions']).toBe(1)
    // Settled, not merely held — a slot still standing would count against the
    // cap twice, once as a hold and once as a redemption.
    expect(docs.get('hosts/host-1/discounts/ten')?.['holds'] ?? {}).toEqual({})
  })

  it('refuses once the cap is spent, rather than discounting past it', async () => {
    seedStore({
      discount: { id: 'ten', ...TEN_OFF, maxRedemptions: 1, redemptions: 1 },
    })
    const result = await ring('TENOFF')

    expect(result.status).toBe(400)
    expect(childPaths('hosts/host-1/orders')).toHaveLength(0)
  })
})

/**
 * THE CONTROL THAT PROVES THE GAP IS CLOSED.
 *
 * Same product, same price, same code, three doors. Before this issue the
 * draft link and the register both charged 10000 here while buy-now charged
 * 9000 — the disagreement was the defect, and a per-door assertion cannot see
 * it because each door is individually self-consistent.
 */
describe('the same goods cost the same through every door (AGL-305)', () => {
  it('buy-now, the payment link and the register all charge one price', async () => {
    seedStore({ discount: { id: 'ten', ...TEN_OFF } })
    const bought = await buyNow('TENOFF')

    seedStore({ discount: { id: 'ten', ...TEN_OFF } })
    const drafted = await draftOrder('TENOFF')

    seedStore({ discount: { id: 'ten', ...TEN_OFF } })
    const rung = await ring('TENOFF')

    expect(bought.result.status).toBe(200)
    expect(drafted.result.status).toBe(200)
    expect(rung.status).toBe(200)

    const charged = [
      chargedGoodsCents(bought.body),
      chargedGoodsCents(drafted.body),
      rung.body.totals.totalCents,
    ]
    expect(new Set(charged).size).toBe(1)
    expect(charged[0]).toBe(DISCOUNTED_CENTS)
  })

  it('and one price WITH TAX, which is the harder agreement', async () => {
    // Tax is where two doors most easily diverge: buy-now carries it as a
    // second line item, the payment link as a Stripe Tax Rate on the first,
    // and the register as a figure in its own totals. All three must be the
    // rate on the DISCOUNTED base.
    seedStore({ settings: MANUAL_TEN_PCT, discount: { id: 'ten', ...TEN_OFF } })
    const bought = await buyNow('TENOFF')
    const buyNowTax = Number(
      bought.body?.get('line_items[1][price_data][unit_amount]') ?? 0,
    )

    seedStore({ settings: MANUAL_TEN_PCT, discount: { id: 'ten', ...TEN_OFF } })
    const drafted = await draftOrder('TENOFF')
    const draftTax = orderDoc().totals.taxCents

    seedStore({ settings: MANUAL_TEN_PCT, discount: { id: 'ten', ...TEN_OFF } })
    const rung = await ring('TENOFF')

    expect(bought.result.status).toBe(200)
    expect(drafted.result.status).toBe(200)
    expect(rung.status).toBe(200)

    const taxes = [buyNowTax, draftTax, rung.body.totals.taxCents]
    expect(new Set(taxes).size).toBe(1)
    expect(taxes[0]).toBe(TAX_ON_DISCOUNTED)
  })

  it('and all three refuse the SAME unusable code', async () => {
    // A door that accepted a code the others refused would be the same defect
    // wearing the opposite sign.
    seedStore({ discount: { id: 'ten', ...TEN_OFF, enabled: false } })
    const bought = await buyNow('TENOFF')

    seedStore({ discount: { id: 'ten', ...TEN_OFF, enabled: false } })
    const drafted = await draftOrder('TENOFF')

    seedStore({ discount: { id: 'ten', ...TEN_OFF, enabled: false } })
    const rung = await ring('TENOFF')

    expect(bought.result.status).toBe(400)
    expect(drafted.result.status).toBe(400)
    expect(rung.status).toBe(400)
    const reasons = [
      String(bought.result.body.error),
      String(drafted.result.body.error),
      String(rung.body.error),
    ]
    expect(new Set(reasons).size).toBe(1)
  })
})
