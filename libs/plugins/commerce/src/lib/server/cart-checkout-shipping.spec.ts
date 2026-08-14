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
 * Shipping reaches the Checkout Session (AGL-1707).
 *
 * The model half is specced in `commerce-shipping.spec.ts`; what is proved
 * HERE is the wiring the defect was about — that the merchant's saved
 * settings document is actually read and actually lands on the session as
 * `shipping_options`. A model that resolves rates nobody sends is exactly the
 * state this issue found.
 *
 * Stripe is mocked absolutely, as in `pos-order.spec.ts`: localhost carries
 * the LIVE secret key, so nothing in this file may reach api.stripe.com. The
 * assertions read the form body the handler built, which is the artefact that
 * decides whether shipping is charged.
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
  firebaseAdmin: { app: () => ({ firestore: () => fakeFirestore }) },
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

function makeRequest(): PluginApiRequest {
  return {
    method: 'POST',
    body: { hostId: 'host-1' },
    cookies: { 'aglyn_cart_host-1': 'cart-1' },
    headers: { host: 'shop.example.com' },
    query: {},
  } as unknown as PluginApiRequest
}

/** Seeds a host that can sell, with one 800g $60 item in the cart. */
function seedStore(storeSettings: Record<string, any> | null) {
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
  })
  if (storeSettings) docs.set('hosts/host-1/settings/store', storeSettings)
}

async function runCheckout(storeSettings: Record<string, any> | null) {
  seedStore(storeSettings)
  sessionBody = null
  const { res, result } = makeResponse()
  await cartCheckoutHandler(makeRequest(), res)
  return { result, body: sessionBody as URLSearchParams | null }
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
  zones: [
    { id: 'us', name: 'United States', countries: ['US'] },
    { id: 'world', name: 'Everywhere else', countries: ['*'] },
  ],
  rates: [
    { id: 'std', zoneId: 'us', name: 'Standard', kind: 'flat', amountCents: 799 },
    {
      id: 'intl',
      zoneId: 'world',
      name: 'International',
      kind: 'flat',
      amountCents: 2999,
    },
  ],
}

describe('cart checkout shipping options (AGL-1707)', () => {
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
  })

  it('declares the merchant’s configured rates on the session', async () => {
    const { result, body } = await runCheckout({ shipping })
    expect(result.status).toBe(200)
    expect(shippingOptions(body)).toEqual([
      {
        name: 'Standard',
        amount: '799',
        currency: 'usd',
        type: 'fixed_amount',
      },
      {
        name: 'International',
        amount: '2999',
        currency: 'usd',
        type: 'fixed_amount',
      },
    ])
  })

  it('declares none for a merchant who configured no shipping', async () => {
    // The regression that would matter most: a merchant who never set
    // shipping up must keep charging none. Both an absent settings doc and a
    // doc that carries only tax.
    for (const settings of [null, { tax: { mode: 'stripe' } }]) {
      const { result, body } = await runCheckout(settings)
      expect(result.status).toBe(200)
      expect(shippingOptions(body)).toEqual([])
      expect([...(body as URLSearchParams).keys()]).not.toContainEqual(
        expect.stringContaining('shipping_options'),
      )
    }
  })

  it('leaves the collectable countries and the tax opt-in alone', async () => {
    const { body } = await runCheckout({ shipping, tax: { mode: 'stripe' } })
    expect(
      ['0', '1', '2', '3', '4', '5'].map((index) =>
        body?.get(`shipping_address_collection[allowed_countries][${index}]`),
      ),
    ).toEqual(['US', 'CA', 'GB', 'AU', 'DE', 'FR'])
    expect(body?.get('automatic_tax[enabled]')).toBe('true')
  })

  it('prices a weight-tiered rate off the cart’s real weight', async () => {
    // 2 x 400g = 800g, which is past the 500g tier. A handler that never
    // summed variant weight would quote the 599 tier here.
    const { body } = await runCheckout({
      shipping: {
        zones: [{ id: 'us', name: 'US', countries: ['*'] }],
        rates: [
          {
            id: 'wt',
            zoneId: 'us',
            name: 'By weight',
            kind: 'weight_tiers',
            tiers: [
              { upTo: 500, amountCents: 599 },
              { upTo: 2000, amountCents: 1299 },
            ],
          },
        ],
      },
    })
    expect(shippingOptions(body)).toEqual([
      { name: 'By weight', amount: '1299', currency: 'usd', type: 'fixed_amount' },
    ])
  })

  it('prices free_over off the pre-discount cart subtotal', async () => {
    // 2 x $30 = $60, past a $50 threshold, so the rate resolves to free
    // rather than being omitted.
    const { body } = await runCheckout({
      shipping: {
        zones: [{ id: 'us', name: 'US', countries: ['*'] }],
        rates: [
          {
            id: 'free50',
            zoneId: 'us',
            name: 'Free over $50',
            kind: 'free_over',
            amountCents: 799,
            freeOverCents: 5000,
          },
        ],
      },
    })
    expect(shippingOptions(body)).toEqual([
      {
        name: 'Free over $50',
        amount: '0',
        currency: 'usd',
        type: 'fixed_amount',
      },
    ])
  })
})
