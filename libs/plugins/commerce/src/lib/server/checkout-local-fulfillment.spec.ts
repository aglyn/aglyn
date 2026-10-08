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
import { checkoutHandler } from './checkout'
import { resolveSiteTimeZone } from '@aglyn/aglyn/app-utils/collection-entry-date'
import { upcomingLocalDeliveryWindows } from '../model/local-fulfillment-settings'

/**
 * Pickup and local delivery on a product's Buy button (AGL-3624): the same
 * decisions as the cart, from the same module, on the buy-now session. The
 * harness is `checkout-shipping.spec.ts`'s, with collections that list what
 * was seeded; Stripe is never reached.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()

/**
 * FIRESTORE'S DEEP MERGE AND THE DELETE SENTINEL (AGL-2453).
 *
 * `set(…, { merge: true })` merges a nested MAP key by key rather than
 * replacing it, and only a `FieldValue.delete()` sentinel removes one of its
 * keys. The promotion hold this handler now places is exactly such a nested
 * map, so a shallow fake would report a document shape the product never
 * produces. Modelled here for the same reason `gift-card-hold-race.spec.ts`
 * models it — that file is the canonical version, including the contention
 * model this one deliberately omits.
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
    } else if (value && typeof value === 'object' && value.__increment != null) {
      next[key] = Number(next[key] ?? 0) + Number(value.__increment)
    } else if (value && typeof value === 'object' && value.__arrayUnion) {
      next[key] = [...(next[key] ?? []), value.__arrayUnion]
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

function writeDoc(
  path: string,
  value: Record<string, any>,
  merge: boolean,
): void {
  docs.set(path, merge ? mergeInto(docs.get(path) ?? {}, value) : value)
}

/**
 * Buffered writes applied at commit, and NOTHING ELSE.
 *
 * There is no version tracking here on purpose: contention is modelled in
 * `promotion-hold-race.spec.ts`, which is where two checkouts race for the last
 * redemption slot. This fake exists only so the handler's transaction can run
 * at all, and a green in this file is a statement about pricing, never about
 * concurrency. A fake that quietly pretended to model contention would be worse
 * than none — it would report green for exactly the bug it could not see.
 */
async function runTransaction(
  body: (transaction: any) => Promise<any>,
): Promise<any> {
  const writes: Array<[string, Record<string, any>, boolean]> = []
  const transaction = {
    get: async (ref: any) => makeSnapshot(ref.path),
    set: (ref: any, value: Record<string, any>, options?: any) => {
      writes.push([ref.path, value, Boolean(options?.merge)])
    },
    update: (ref: any, value: Record<string, any>) => {
      writes.push([ref.path, value, true])
    },
  }
  const result = await body(transaction)
  for (const [path, value, merge] of writes) writeDoc(path, value, merge)
  return result
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
      writeDoc(path, value, Boolean(options?.merge))
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  return {
    doc: (id: string) => makeDocRef(`${path}/${id}`),
    // `limit()` is chainable and `get()` answers an empty collection: buy-now
    // reads `hosts/{id}/discounts` on every checkout since and a
    // double without these throws where Firestore would simply return nothing.
    // This suite seeds no discounts, so empty IS the faithful answer.
    limit: () => makeCollectionRef(path),
    get: async () => ({
      docs: [...docs.keys()]
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .map((key) => makeSnapshot(key)),
    }),
  }
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
    firestore: {
      FieldValue: {
        delete: () => DELETE,
        increment: (value: number) => ({ __increment: value }),
        arrayUnion: (value: any) => ({ __arrayUnion: value }),
      },
    },
  },
  getOrgForHost: async () => mockOrg,
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
  throw new Error(`Unexpected Stripe endpoint ${target}`)
})

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
  /** `hosts/host-1/settings/store`, or null for a merchant with no doc. */
  settings?: Record<string, any> | null
  /** Merged over the seeded product doc. */
  product?: Record<string, any>
  /** Units bought — the buy-now path sells ONE product at a quantity. */
  quantity?: number
  couponCode?: string
  /** Seeded at `hosts/host-1/coupons/{couponCode}`. */
  coupon?: Record<string, any>
  billing?: string
  /** What the shopper declared, exactly as it arrives over the wire. */
  shippingCountry?: unknown
  fulfillment?: unknown
  locations?: Record<string, Record<string, any>>
}

/** Seeds a host that can sell one 400g $30 physical product. */
async function runCheckout(scenario: Scenario = {}) {
  docs.clear()
  docs.set('hosts/host-1', { name: 'Acme' })
  docs.set('profiles/owner-1', {
    stripeAccountId: 'acct_1',
    stripeChargesEnabled: true,
  })
  docs.set('hosts/host-1/products/p1', {
    name: 'Kettle',
    status: 'active',
    type: 'physical',
    variants: [{ id: 'v1', priceUsd: 30, weightGrams: 400, inventory: 100 }],
    ...(scenario.product ?? {}),
  })
  // AGL-1999: every scenario in this suite is about SHIPPING, so the store
  // states a tax decision it would otherwise leave unmade — an undecided
  // store refuses the sale before shipping is ever resolved. A scenario that
  // supplies its own `tax` wins.
  docs.set('hosts/host-1/settings/store', {
    tax: { mode: 'none' },
    ...(scenario.settings ?? {}),
  })
  for (const [id, location] of Object.entries(scenario.locations ?? {})) {
    docs.set(`hosts/host-1/locations/${id}`, location)
  }
  if (scenario.couponCode && scenario.coupon) {
    docs.set(`hosts/host-1/coupons/${scenario.couponCode}`, scenario.coupon)
  }
  sessionBody = null
  const { res, result } = makeResponse()
  const req = {
    method: 'POST',
    body: {
      hostId: 'host-1',
      productId: 'p1',
      variantId: 'v1',
      quantity: scenario.quantity ?? 1,
      ...(scenario.couponCode ? { couponCode: scenario.couponCode } : {}),
      ...(scenario.billing ? { billing: scenario.billing } : {}),
      ...('shippingCountry' in scenario
        ? { shippingCountry: scenario.shippingCountry }
        : {}),
      ...(scenario.fulfillment ? { fulfillment: scenario.fulfillment } : {}),
    },
    cookies: {},
    headers: { host: 'shop.example.com' },
    query: {},
  } as unknown as PluginApiRequest
  await checkoutHandler(req, res)
  return { result, body: sessionBody as URLSearchParams | null }
}

/** Every `shipping_options[n]` in the emitted form body, in index order. */
function shippingOptions(body: URLSearchParams | null) {
  if (!body) return []
  const out: { name: string; amount: string; currency: string; type: string }[] =
    []
  for (
    let index = 0;
    body.has(`shipping_options[${index}][shipping_rate_data][display_name]`);
    index += 1
  ) {
    const field = `shipping_options[${index}][shipping_rate_data]`
    out.push({
      name: String(body.get(`${field}[display_name]`)),
      amount: String(body.get(`${field}[fixed_amount][amount]`)),
      currency: String(body.get(`${field}[fixed_amount][currency]`)),
      type: String(body.get(`${field}[type]`)),
    })
  }
  return out
}

/** Every shipping-related key the handler emitted, sorted. */
function shippingKeys(body: URLSearchParams | null) {
  return [...(body?.keys() ?? [])].filter((key) => key.includes('shipping'))
}

/** The countries the session will accept an address in, in emitted order. */
function allowedCountries(body: URLSearchParams | null) {
  const out: string[] = []
  for (
    let index = 0;
    body?.has(`shipping_address_collection[allowed_countries][${index}]`);
    index += 1
  ) {
    out.push(
      String(
        body.get(`shipping_address_collection[allowed_countries][${index}]`),
      ),
    )
  }
  return out
}

const mainStreet = {
  name: 'Main Street',
  address: '1 Main St',
  pickup: { enabled: true },
}
const localDelivery = {
  enabled: true,
  country: 'US',
  zones: [{ id: 'near', name: 'Downtown', kind: 'postcode', postcodes: ['627*'], feeCents: 400 }],
  windows: 'Mo-Su 09:00-12:00\nMo-Su 13:00-17:00',
  leadTimeMinutes: 0,
}
const shipping = {
  zones: [{ id: 'all', name: 'Everywhere', countries: ['*'] }],
  rates: [{ id: 'std', zoneId: 'all', name: 'Standard', kind: 'flat', amountCents: 799 }],
  localPickup: true,
}

describe('buy-now pickup and local delivery (AGL-3624)', () => {
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
  beforeEach(() => fetchMock.mockClear())

  it('a pickup charges no shipping, collects no address and names the location', async () => {
    const { result, body } = await runCheckout({
      settings: { shipping },
      locations: { main: mainStreet },
      fulfillment: { method: 'pickup', locationId: 'main' },
    })
    expect(result.status).toBe(200)
    expect(shippingOptions(body)).toEqual([])
    expect(allowedCountries(body)).toEqual([])
    expect(body?.get('metadata[fulfillment]')).toBe('pickup')
    expect(body?.get('metadata[pickupLocationId]')).toBe('main')
  })

  it('a delivery charges the zone fee as its one option, in the store’s country', async () => {
    const window = upcomingLocalDeliveryWindows(localDelivery as never, {
      nowMs: Date.now(),
      timeZone: resolveSiteTimeZone(mockOrg.org, null),
    })[0]
    const { result, body } = await runCheckout({
      settings: { shipping, localDelivery },
      fulfillment: { method: 'local_delivery', postalCode: '62704', windowStartMs: window.startMs },
    })
    expect(result.status).toBe(200)
    expect(shippingOptions(body).map((option) => option.amount)).toEqual(['400'])
    expect(allowedCountries(body)).toEqual(['US'])
    expect(body?.get('metadata[deliveryZoneId]')).toBe('near')
  })

  it('refuses before anything is minted, and drops the unnamed pickup when shipping', async () => {
    const refused = await runCheckout({
      settings: { shipping },
      locations: { main: { ...mainStreet, pickup: { enabled: false } } },
      fulfillment: { method: 'pickup', locationId: 'main' },
    })
    expect(refused.result.status).toBe(409)
    expect(refused.body).toBeNull()
    const shipped = await runCheckout({ settings: { shipping }, locations: { main: mainStreet } })
    expect(shippingOptions(shipped.body).map((option) => option.name)).toEqual(['Standard'])
  })

  it('ignores a declaration on a download', async () => {
    const { body } = await runCheckout({
      settings: { shipping },
      locations: { main: mainStreet },
      product: { type: 'digital' },
      fulfillment: { method: 'pickup', locationId: 'main' },
    })
    expect(body?.get('metadata[fulfillment]')).toBeNull()
  })
})
