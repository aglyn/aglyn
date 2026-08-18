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
import { checkoutHandler } from './checkout'
import {
  NATIVE_CHECKOUT_STRIPE_VERSION,
  applyNativeCheckoutParams,
  readCheckoutSessionPayload,
} from './native-checkout'

/**
 * The storefront Payment Element (AGL-1944).
 *
 * What this file is actually for is PARITY. The danger in a second checkout
 * path is not that it fails — a failing checkout gets noticed within the hour —
 * it is that it succeeds while charging a different number. So the central test
 * here builds the same purchase twice, once hosted and once native, and asserts
 * the two Stripe param sets are IDENTICAL except for the four keys that are
 * allowed to differ. Anything a future edit adds to one path and not the other
 * fails that test without anyone having to think of it.
 *
 * `global.fetch` is replaced for the whole file — nothing here may reach
 * api.stripe.com.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore (same shape as checkout-idempotency.spec.ts)
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
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  return {
    doc: (id?: string) =>
      makeDocRef(`${path}/${id ?? `auto-${++autoIdCounter}`}`),
    get: async () => ({ docs: childPaths(path).map(makeSnapshot) }),
  }
}

const fakeFirestore = { collection: (name: string) => makeCollectionRef(name) }

const mockOrg: any = {
  org: {
    id: 'org-1',
    plan: 'business',
    subscriptionStatus: 'active',
    ownerUid: 'owner-1',
    slug: 'acme',
  },
}

/**
 * The flag verdict, per test. The real resolver reads Remote Config and the org
 * doc; what matters to this file is only that BOTH the flag and the key gate
 * the decision, so the flag is a switch and the key is an env var.
 */
let flagOn = false

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
  },
  getOrgForHost: async () => mockOrg,
  isServerReleaseFlagOnForOrg: async () => flagOn,
}))

// ---------------------------------------------------------------------------
// Stripe boundary — recorded, never reached
// ---------------------------------------------------------------------------

interface StripeCall {
  url: string
  params: URLSearchParams
  headers: Record<string, string>
}

const stripeCalls: StripeCall[] = []
let stripeObjectCounter = 0

function sessionCall(): StripeCall {
  const calls = stripeCalls.filter((call) =>
    call.url.includes('checkout/sessions'),
  )
  expect(calls).toHaveLength(1)
  return calls[0]
}

const fetchMock = jest.fn(async (url: any, init: any): Promise<any> => {
  const target = String(url)
  if (!target.includes('api.stripe.com')) {
    throw new Error(`Unexpected fetch to ${target}`)
  }
  stripeCalls.push({
    url: target,
    params: new URLSearchParams(String(init?.body ?? '')),
    headers: (init?.headers ?? {}) as Record<string, string>,
  })
  const id = `cs_${++stripeObjectCounter}`
  if (target.includes('tax_rates')) {
    return { ok: true, json: async () => ({ id: `txr_${stripeObjectCounter}` }) }
  }
  // Stripe returns a client secret and NO url for a `ui_mode` session, and a
  // url and NO client secret otherwise — measured against live Stripe in test
  // mode. A double that returned both would let a broken payload check pass.
  const native = new URLSearchParams(String(init?.body ?? '')).get('ui_mode')
  return {
    ok: true,
    json: async () =>
      native
        ? { id, client_secret: `${id}_secret_abc`, ui_mode: native }
        : { id, url: `https://checkout.stripe.com/pay/${id}` },
  }
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
      /* unused */
    },
    redirect() {
      /* unused */
    },
    end() {
      /* unused */
    },
  } as PluginApiResponse
  return { res, result }
}

async function post(body: Record<string, unknown> = {}) {
  const { res, result } = makeResponse()
  await checkoutHandler(
    {
      method: 'POST',
      query: {},
      body: {
        hostId: 'host-1',
        productId: 'product-1',
        quantity: 2,
        // Declared, because the store below serves ONE zone and Stripe is told
        // which countries the session may collect (AGL-1721) — without it the
        // handler answers `needsShippingCountry` and never reaches Stripe.
        shippingCountry: 'US',
        ...body,
      },
      headers: {
        host: 'acme.aglyn.app',
        referer: 'https://acme.aglyn.app/products/widget',
        'idempotency-key': `attempt-${++autoIdCounter}`,
      },
      cookies: {},
      socket: {},
    } as PluginApiRequest,
    res,
  )
  return result
}

/** A store with manual tax AND shipping configured — the busiest param set. */
function seedStore() {
  docs.set('hosts/host-1', { name: 'Acme' })
  docs.set('hosts/host-1/products/product-1', {
    name: 'Widget',
    type: 'physical',
    priceUsd: 25,
    variants: [{ id: 'v1', priceUsd: 25, stock: 100, weightGrams: 400 }],
  })
  docs.set('hosts/host-1/settings/store', {
    tax: {
      mode: 'manual',
      pricesIncludeTax: false,
      origin: { country: 'US', state: 'TX' },
      rates: [{ country: 'US', state: 'TX', pct: 8.25 }],
    },
    shipping: {
      zones: [{ id: 'us', name: 'United States', countries: ['US'] }],
      rates: [
        {
          id: 'std',
          zoneId: 'us',
          name: 'Standard',
          kind: 'flat',
          amountCents: 799,
        },
      ],
    },
  })
  docs.set('profiles/owner-1', {
    stripeAccountId: 'acct_merchant',
    stripeChargesEnabled: true,
  })
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
})

beforeEach(() => {
  docs.clear()
  stripeCalls.length = 0
  autoIdCounter = 0
  stripeObjectCounter = 0
  fetchMock.mockClear()
  flagOn = false
  delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  seedStore()
})

// ---------------------------------------------------------------------------
// The gate: BOTH the flag and the key
// ---------------------------------------------------------------------------

describe('the native gate needs the flag AND the publishable key', () => {
  it('redirects when neither is present — the shipped default', async () => {
    const result = await post()
    expect(result.status).toBe(200)
    expect(result.body.url).toContain('checkout.stripe.com')
    expect(result.body.clientSecret).toBeUndefined()
    expect(sessionCall().params.get('ui_mode')).toBeNull()
  })

  it('redirects when the FLAG is on but no publishable key is set', async () => {
    // The storefront's real production state on 2026-08-18: `aglyn-tenant`
    // carries no `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` at all. Flipping the flag
    // must not strand a shopper with a client secret nothing can mount.
    flagOn = true
    const result = await post()
    expect(result.body.url).toContain('checkout.stripe.com')
    expect(sessionCall().params.get('ui_mode')).toBeNull()
  })

  it('redirects when the KEY is set but the flag is off', async () => {
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_key'
    const result = await post()
    expect(result.body.url).toContain('checkout.stripe.com')
    expect(sessionCall().params.get('ui_mode')).toBeNull()
  })

  it('redirects rather than 500s when the flag resolver is unavailable', async () => {
    // Not hypothetical: every checkout spec that predates AGL-1944 mocks
    // `@aglyn/tenant-data-admin` without this export, so the resolver is
    // literally `undefined` there and calling it throws SYNCHRONOUSLY. A sale
    // must never be lost to a flag lookup.
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_key'
    const admin = jest.requireMock('@aglyn/tenant-data-admin') as any
    const real = admin.isServerReleaseFlagOnForOrg
    admin.isServerReleaseFlagOnForOrg = undefined
    try {
      const result = await post()
      expect(result.status).toBe(200)
      expect(result.body.url).toContain('checkout.stripe.com')
    } finally {
      admin.isServerReleaseFlagOnForOrg = real
    }
  })

  it('goes native only when both hold', async () => {
    flagOn = true
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_key'
    const result = await post()
    expect(result.status).toBe(200)
    expect(result.body.clientSecret).toMatch(/^cs_\d+_secret_/)
    expect(result.body.publishableKey).toBe('pk_test_key')
    expect(result.body.sessionId).toMatch(/^cs_/)
    // The shopper must not be handed a URL to navigate to — the whole point.
    expect(result.body.url).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Parity — the test this file exists for
// ---------------------------------------------------------------------------

describe('tax, shipping, fee and metadata are identical on both paths', () => {
  it('differs in EXACTLY the four routing keys and nothing else', async () => {
    await post()
    const hosted = sessionCall().params

    stripeCalls.length = 0
    docs.clear()
    seedStore()
    autoIdCounter = 100
    flagOn = true
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_key'
    await post()
    const native = sessionCall().params

    const keys = (params: URLSearchParams) => [...params.keys()].sort()
    const routing = ['success_url', 'cancel_url', 'ui_mode', 'return_url']
    expect(keys(hosted).filter((key) => !routing.includes(key))).toEqual(
      keys(native).filter((key) => !routing.includes(key)),
    )
    // Values, not just key names — a path that kept every key and halved the
    // tax would sail through a key comparison.
    for (const key of keys(hosted)) {
      if (routing.includes(key)) continue
      expect([key, native.get(key)]).toEqual([key, hosted.get(key)])
    }

    // And the store really was the busy one, so the comparison above had
    // something to compare. A parity assertion over an empty param set is the
    // guard that cannot fail.
    expect(hosted.get('line_items[1][price_data][unit_amount]')).toBe('413')
    expect(hosted.get('line_items[1][price_data][product_data][name]')).toBe(
      'Tax (8.25%)',
    )
    expect(
      hosted.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'),
    ).toBe('799')
    expect(hosted.get('payment_intent_data[transfer_data][destination]')).toBe(
      'acct_merchant',
    )
    expect(hosted.get('metadata[taxCents]')).toBe('413')
  })

  it('swaps the URL pair rather than adding to it — Stripe rejects both', async () => {
    flagOn = true
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_key'
    await post()
    const params = sessionCall().params
    expect(params.get('ui_mode')).toBe('custom')
    expect(params.get('success_url')).toBeNull()
    expect(params.get('cancel_url')).toBeNull()
    // The session id still rides the return, so the storefront can NAME the
    // order it completed without being told the outcome by the client.
    expect(params.get('return_url')).toContain('session_id={CHECKOUT_SESSION_ID}')
  })

  it('pins the API version on the native request only', async () => {
    await post()
    expect(sessionCall().headers['Stripe-Version']).toBeUndefined()

    stripeCalls.length = 0
    flagOn = true
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_key'
    await post()
    expect(sessionCall().headers['Stripe-Version']).toBe(
      NATIVE_CHECKOUT_STRIPE_VERSION,
    )
    // Measured: `ui_mode: custom` is refused below this version, and webhook
    // deliveries are versioned per endpoint so the pin cannot reach them.
    expect(NATIVE_CHECKOUT_STRIPE_VERSION).toBe('2025-03-31.basil')
  })

  it('still carries the idempotency key that stops a double session', async () => {
    flagOn = true
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_key'
    await post()
    expect(sessionCall().headers['Idempotency-Key']).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// The liveness check that had to move with the mode
// ---------------------------------------------------------------------------

describe('readCheckoutSessionPayload', () => {
  it('reads a hosted session by its url', () => {
    expect(
      readCheckoutSessionPayload(
        { id: 'cs_1', url: 'https://checkout.stripe.com/pay/cs_1' },
        { native: false, publishableKey: '' },
      ),
    ).toEqual({ url: 'https://checkout.stripe.com/pay/cs_1' })
  })

  it('refuses a hosted session with no url — nothing was sold', () => {
    expect(
      readCheckoutSessionPayload(
        { id: 'cs_1' },
        { native: false, publishableKey: '' },
      ),
    ).toBeNull()
  })

  it('reads a native session by its client secret, NOT its url', () => {
    // The bug this exists to prevent: a `ui_mode` session has no url, so the
    // old `!session.url` check would have read every successful native session
    // as a Stripe failure — 502 at the shopper, claim released, and a real
    // Checkout Session left open on the merchant's account.
    expect(
      readCheckoutSessionPayload(
        { id: 'cs_1', client_secret: 'cs_1_secret_abc' },
        { native: true, publishableKey: 'pk_test_key' },
      ),
    ).toEqual({
      clientSecret: 'cs_1_secret_abc',
      publishableKey: 'pk_test_key',
      sessionId: 'cs_1',
    })
  })

  it('refuses a native session with no client secret', () => {
    expect(
      readCheckoutSessionPayload(
        { id: 'cs_1', url: 'https://checkout.stripe.com/pay/cs_1' },
        { native: true, publishableKey: 'pk_test_key' },
      ),
    ).toBeNull()
  })
})

describe('applyNativeCheckoutParams', () => {
  it('leaves every money-bearing key untouched', () => {
    const params = new URLSearchParams({
      'line_items[0][price_data][unit_amount]': '2500',
      'line_items[1][price_data][unit_amount]': '413',
      'payment_intent_data[application_fee_amount]': '124',
      'payment_intent_data[transfer_data][destination]': 'acct_merchant',
      'automatic_tax[enabled]': 'true',
      'metadata[taxCents]': '413',
      success_url: 'https://shop.example.com/p?order=success',
      cancel_url: 'https://shop.example.com/p?order=canceled',
    })
    const before = [...params.entries()].filter(
      ([key]) => !key.endsWith('_url'),
    )
    applyNativeCheckoutParams(params, 'https://shop.example.com/p?order=success')
    expect(
      [...params.entries()].filter(
        ([key]) => !key.endsWith('_url') && key !== 'ui_mode',
      ),
    ).toEqual(before)
  })
})
