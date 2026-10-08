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
import { resolveSiteTimeZone } from '@aglyn/aglyn/app-utils/collection-entry-date'
import { upcomingLocalDeliveryWindows } from '../model/local-fulfillment-settings'

/**
 * Pickup and local delivery reach the Checkout Session (AGL-3624).
 *
 * What the cart declares is a request: the location must offer pickup, the
 * postal code must be in a zone, the order must meet the zone's minimum and
 * the window must still be open — all decided here from the store's own
 * settings, before anything is reserved or minted. The assertions read the
 * form body the handler built, the artefact that decides what Stripe charges
 * and which address it collects. Harness shared with
 * `cart-checkout-shipping.spec.ts`; Stripe is never reached.
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
  /** The cart's declaration (AGL-3624), as it arrives over the wire. */
  fulfillment?: unknown
  /** `hosts/host-1/locations/{id}` docs. */
  locations?: Record<string, Record<string, any>>
}

function makeRequest(scenario: Scenario): PluginApiRequest {
  return {
    method: 'POST',
    body: {
      hostId: 'host-1',
      ...(scenario.couponCode ? { couponCode: scenario.couponCode } : {}),
      ...('shippingCountry' in scenario
        ? { shippingCountry: scenario.shippingCountry }
        : {}),
      ...(scenario.fulfillment ? { fulfillment: scenario.fulfillment } : {}),
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
  for (const [id, location] of Object.entries(scenario.locations ?? {})) {
    docs.set(`hosts/host-1/locations/${id}`, location)
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

/** Every `shipping_options[n]` in the emitted form body, in index order. */
function shippingOptions(body: URLSearchParams | null) {
  if (!body) return []
  const out: { name: string; amount: string; currency: string; type: string }[] =
    []
  for (let index = 0; body.has(`shipping_options[${index}][shipping_rate_data][display_name]`); index += 1) {
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


const shipping = {
  zones: [{ id: 'us', name: 'United States', countries: ['US'] }],
  rates: [{ id: 'std', zoneId: 'us', name: 'Standard', kind: 'flat', amountCents: 799 }],
  localPickup: true,
}

const mainStreet = {
  name: 'Main Street',
  isDefault: true,
  postalAddress: { line1: '1 Main St', city: 'Springfield', postalCode: '62701', country: 'US' },
  pickup: { enabled: true, hours: 'Mo-Fr 09:00-17:00', instructions: 'Side door' },
}

const localDelivery = {
  enabled: true,
  country: 'US',
  locationId: 'main',
  zones: [
    { id: 'near', name: 'Downtown', kind: 'postcode', postcodes: ['627*'], feeCents: 500, minimumCents: 2000 },
    { id: 'far', name: 'County', kind: 'postcode', postcodes: ['62800-62899'], feeCents: 1200, minimumCents: 10_000 },
  ],
  windows: 'Mo-Su 09:00-12:00\nMo-Su 13:00-17:00',
  leadTimeMinutes: 0,
}

/** The first window the store offers right now, as the cart would show it. */
function firstWindow() {
  const window = upcomingLocalDeliveryWindows(localDelivery as never, {
    nowMs: Date.now(),
    timeZone: resolveSiteTimeZone(mockOrg.org, null),
  })[0]
  if (!window) throw new Error('no window')
  return window
}

describe('cart checkout pickup and local delivery (AGL-3624)', () => {
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
  })

  it('a pickup charges no shipping, collects no address, and routes the session to the location', async () => {
    const { result, body } = await runCheckout(
      { shipping },
      { fulfillment: { method: 'pickup', locationId: 'main' }, locations: { main: mainStreet } },
    )
    expect(result.status).toBe(200)
    expect(shippingOptions(body)).toEqual([])
    expect(allowedCountries(body)).toEqual([])
    expect(body?.get('metadata[fulfillment]')).toBe('pickup')
    expect(body?.get('metadata[pickupLocationId]')).toBe('main')
  })

  it('reserves a pickup’s units at that location', async () => {
    const { result } = await runCheckout(
      { shipping },
      {
        fulfillment: { method: 'pickup', locationId: 'main' },
        locations: { main: mainStreet },
        product: { variants: [{ id: 'v1', priceUsd: 30, inventory: 10, inventoryByLocation: { main: 4, back: 6 } }] },
      },
    )
    expect(result.status).toBe(200)
    const holds = Object.values((docs.get('hosts/host-1/products/p1') as any).stockHolds ?? {}) as any[]
    expect(holds).toHaveLength(1)
    expect(holds[0]).toMatchObject({ units: { v1: 2 }, locationId: 'main' })
  })

  it('refuses a pickup the location cannot fill, before anything is minted, and says where', async () => {
    const { result, body } = await runCheckout(
      { shipping },
      {
        fulfillment: { method: 'pickup', locationId: 'main' },
        locations: { main: mainStreet },
        product: { variants: [{ id: 'v1', priceUsd: 30, inventory: 10, inventoryByLocation: { main: 1, back: 9 } }] },
      },
    )
    expect(result.status).toBe(409)
    expect(result.body.error).toBe(
      '"Kettle" is not in stock at Main Street. Choose another location, or have it shipped.',
    )
    expect(body).toBeNull()
  })

  it('refuses a location that does not offer pickup, and tells the cart to ask again', async () => {
    const { result, body } = await runCheckout(
      { shipping },
      {
        fulfillment: { method: 'pickup', locationId: 'main' },
        locations: { main: { ...mainStreet, pickup: { enabled: false } } },
      },
    )
    expect(result.status).toBe(409)
    expect(result.body.fulfillmentChanged).toBe('pickup')
    expect(body).toBeNull()
    expect(stripeCalls('/v1/checkout/sessions')).toBe(0)
  })

  it('drops the unnamed pickup rate from a shipped session once a location offers pickup', async () => {
    const withLocations = await runCheckout(
      { shipping },
      { shippingCountry: 'US', locations: { main: mainStreet } },
    )
    expect(shippingOptions(withLocations.body).map((option) => option.name)).toEqual(['Standard'])
    const without = await runCheckout({ shipping }, { shippingCountry: 'US' })
    expect(shippingOptions(without.body).map((option) => option.name)).toEqual(['Local pickup', 'Standard'])
  })

  it('a delivery charges the zone’s fee as the one shipping option, for an address in the store’s country', async () => {
    const window = firstWindow()
    const { result, body } = await runCheckout(
      { shipping, localDelivery },
      {
        fulfillment: { method: 'local_delivery', postalCode: '62704', windowStartMs: window.startMs },
        locations: { main: mainStreet },
      },
    )
    expect(result.status).toBe(200)
    const options = shippingOptions(body)
    expect(options).toHaveLength(1)
    expect(options[0]).toMatchObject({ amount: '500', currency: 'usd', type: 'fixed_amount' })
    expect(options[0].name.startsWith('Local delivery — ')).toBe(true)
    expect(allowedCountries(body)).toEqual(['US'])
    expect(body?.get('metadata[fulfillment]')).toBe('local_delivery')
    expect(body?.get('metadata[deliveryZoneId]')).toBe('near')
    expect(body?.get('metadata[deliveryWindowStartMs]')).toBe(String(window.startMs))
    expect(body?.get('metadata[deliveryFeeCents]')).toBe('500')
    expect(body?.get('metadata[deliveryLocationId]')).toBe('main')
  })

  it('refuses a delivery below the zone’s minimum, with the amount still to add', async () => {
    const { result, body } = await runCheckout(
      { shipping, localDelivery },
      {
        fulfillment: { method: 'local_delivery', postalCode: '62810', windowStartMs: firstWindow().startMs },
      },
    )
    expect(result.status).toBe(409)
    expect(result.body.error).toBe(
      'Delivery to 62810 needs an order of at least $100.00. Add $40.00 more, or choose shipping or pickup.',
    )
    expect(body).toBeNull()
  })

  it('refuses a postal code no zone names, and a window that is not open', async () => {
    const outside = await runCheckout(
      { shipping, localDelivery },
      { fulfillment: { method: 'local_delivery', postalCode: '90210', windowStartMs: firstWindow().startMs } },
    )
    expect(outside.result.status).toBe(409)
    expect(outside.result.body.error).toBe('We don’t deliver to 90210. Choose shipping or pickup instead.')
    const stale = await runCheckout(
      { shipping, localDelivery },
      { fulfillment: { method: 'local_delivery', postalCode: '62704', windowStartMs: 12345 } },
    )
    expect(stale.result.status).toBe(409)
    expect(stale.result.body.fulfillmentChanged).toBe('delivery')
    expect(stripeCalls('/v1/checkout/sessions')).toBe(0)
  })

  it('never takes the fee from the request', async () => {
    const { body } = await runCheckout(
      { shipping, localDelivery },
      {
        fulfillment: {
          method: 'local_delivery',
          postalCode: '62704',
          windowStartMs: firstWindow().startMs,
          feeCents: 0,
        },
      },
    )
    expect(shippingOptions(body)[0]?.amount).toBe('500')
  })

  it('makes a free-shipping discount free delivery too', async () => {
    const { body } = await runCheckout(
      { shipping, localDelivery },
      {
        fulfillment: { method: 'local_delivery', postalCode: '62704', windowStartMs: firstWindow().startMs },
        discounts: [{ id: 'd1', code: 'FREESHIP', enabled: true, kind: 'free_shipping' }],
        couponCode: 'FREESHIP',
      },
    )
    expect(shippingOptions(body).map((option) => option.amount)).toEqual(['0'])
  })

  it('ignores a declaration for a cart with nothing physical in it', async () => {
    const { result, body } = await runCheckout(
      { shipping },
      {
        fulfillment: { method: 'pickup', locationId: 'main' },
        locations: { main: mainStreet },
        product: { type: 'digital' },
      },
    )
    expect(result.status).toBe(200)
    expect(body?.get('metadata[fulfillment]')).toBeNull()
  })
})
