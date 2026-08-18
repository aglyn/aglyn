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

/**
 * Buy-now checkout idempotency (AGL-1697, item 6).
 *
 * Session-only server side, so a retry looked free — but for
 * `mode: subscription` two completed sessions are two RECURRING
 * subscriptions for the same member and product, with no guard in the file.
 * A subscription attempt with manual tax also creates a Stripe Tax Rate
 * before the session, so it is a multi-object attempt and carries one derived
 * key per object (AGL-1714's rule).
 *
 * `global.fetch` is replaced for the whole file — nothing here may reach
 * api.stripe.com, localhost carries the LIVE secret key.
 *
 * NOT covered here, deliberately: a deliberate second subscription under a
 * fresh key is indistinguishable from a first one without buyer identity,
 * which this anonymous storefront path does not have — that is the
 * entitlement-guard follow-up noted on the issue.
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
const stripeResponsesByKey = new Map<string, any>()
let stripeObjectCounter = 0

function sessionCalls() {
  return stripeCalls.filter((call) => call.url.includes('checkout/sessions'))
}

function taxRateCalls() {
  return stripeCalls.filter((call) => call.url.includes('tax_rates'))
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
  const payload = target.includes('tax_rates')
    ? { id: `txr_${++stripeObjectCounter}` }
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
    body: { hostId: 'host-1', productId: 'product-1', quantity: 1, ...body },
    headers: { host: 'acme.aglyn.app', ...headers },
    cookies: {},
    socket: {},
  } as PluginApiRequest
  await checkoutHandler(request, res)
  return result
}

function claimDocs() {
  return childPaths('apiIdempotency')
}

const MANUAL_TAX = {
  tax: {
    mode: 'manual',
    pricesIncludeTax: false,
    origin: { country: 'US', state: 'TX' },
    rates: [{ country: 'US', state: 'TX', pct: 8.25 }],
  },
}

/** Rates that DIFFER by destination, so the server must ask (AGL-1721). */
const ZONED_SHIPPING = {
  shipping: {
    zones: [
      { id: 'us', name: 'United States', countries: ['US'] },
      { id: 'world', name: 'Everywhere else', countries: ['*'] },
    ],
    rates: [
      { id: 'std', zoneId: 'us', name: 'Standard', kind: 'flat', amountCents: 799 },
      { id: 'intl', zoneId: 'world', name: 'International', kind: 'flat', amountCents: 2999 },
    ],
  },
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

  docs.set('hosts/host-1', {})
  docs.set('hosts/host-1/products/product-1', {
    name: 'Walnut desk',
    type: 'physical',
    status: 'active',
    variants: [{ id: 'default', priceUsd: 40, inventory: null }],
  })
  docs.set('hosts/host-1/settings/store', {})
  docs.set('profiles/owner-1', {
    stripeAccountId: 'acct_live_merchant',
    stripeChargesEnabled: true,
  })
})

// ---------------------------------------------------------------------------

describe('buy-now checkout idempotency (AGL-1697)', () => {
  it('creates one session and records the claim', async () => {
    const result = await post({}, { 'idempotency-key': 'attempt-a' })
    expect(result.status).toBe(200)
    expect(result.body.url).toContain('checkout.stripe.com')
    expect(sessionCalls()).toHaveLength(1)
    expect(sessionCalls()[0].idempotencyKey).toBeTruthy()
    expect(claimDocs()).toHaveLength(1)
    expect(docs.get(claimDocs()[0])?.['status']).toBe('done')
  })

  /**
   * THE DEFECT. For `mode: subscription` two completed sessions are two
   * RECURRING subscriptions for the same member and product — asserted in
   * subscription mode because that is where the retry costs the most.
   */
  it('replays a retried subscription checkout instead of a second session', async () => {
    docs.set('hosts/host-1/products/product-1', {
      name: 'Members club',
      type: 'digital',
      status: 'active',
      subscription: { interval: 'month' },
      variants: [{ id: 'default', priceUsd: 15, inventory: null }],
    })
    const first = await post({}, { 'idempotency-key': 'attempt-a' })
    const second = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body.url).toBe(first.body.url)
    expect(sessionCalls()).toHaveLength(1)
    expect(sessionCalls()[0].params.get('mode')).toBe('subscription')
  })

  it('opens a genuinely new checkout under a fresh attempt key', async () => {
    await post({}, { 'idempotency-key': 'attempt-a' })
    const second = await post({}, { 'idempotency-key': 'attempt-b' })
    expect(second.status).toBe(200)
    expect(sessionCalls()).toHaveLength(2)
  })

  /**
   * The multi-object attempt (AGL-1714): a subscription with manual tax
   * creates a Tax Rate AND a session. Each carries its own derivation of the
   * digest — Stripe parameter-compares a repeated key account-wide — and a
   * doubled request adds zero calls.
   */
  it('derives distinct keys for the tax rate and the session', async () => {
    docs.set('hosts/host-1/products/product-1', {
      name: 'Members club',
      type: 'digital',
      status: 'active',
      subscription: { interval: 'month' },
      variants: [{ id: 'default', priceUsd: 15, inventory: null }],
    })
    docs.set('hosts/host-1/settings/store', MANUAL_TAX)

    const first = await post({}, { 'idempotency-key': 'attempt-c' })
    expect(first.status).toBe(200)
    expect(taxRateCalls()).toHaveLength(1)
    expect(sessionCalls()).toHaveLength(1)
    expect(taxRateCalls()[0].idempotencyKey).toBeTruthy()
    expect(sessionCalls()[0].idempotencyKey).toBeTruthy()
    expect(taxRateCalls()[0].idempotencyKey).not.toBe(
      sessionCalls()[0].idempotencyKey,
    )

    const second = await post({}, { 'idempotency-key': 'attempt-c' })
    expect(second.status).toBe(200)
    expect(stripeCalls).toHaveLength(2)
  })

  /**
   * The release-on-deterministic-failure rule (AGL-1714): the shipping
   * destination ask lands BELOW the claim — the tax rate may already exist by
   * then — so it must release rather than burn the key, and the answered
   * retry must succeed under the SAME key.
   */
  it('releases the key on the shipping-destination ask', async () => {
    docs.set('hosts/host-1/settings/store', ZONED_SHIPPING)
    const asked = await post({}, { 'idempotency-key': 'attempt-d' })
    expect(asked.status).toBe(400)
    expect(asked.body.needsShippingCountry).toBe(true)
    expect(claimDocs()).toHaveLength(0)
    expect(sessionCalls()).toHaveLength(0)

    const retry = await post(
      { shippingCountry: 'US' },
      { 'idempotency-key': 'attempt-d' },
    )
    expect(retry.status).toBe(200)
    expect(sessionCalls()).toHaveLength(1)
  })

  /** A failed session releases the claim so the product is not locked out. */
  it('releases the claim when the session fails', async () => {
    // Recorded like every other call — the assertion below compares the
    // failed call's key with the retry's.
    fetchMock.mockImplementationOnce(async (url: any, init: any) => {
      stripeCalls.push({
        url: String(url),
        idempotencyKey:
          (init?.headers?.['Idempotency-Key'] as string | undefined) ?? null,
        params: new URLSearchParams(String(init?.body ?? '')),
      })
      return {
        ok: false,
        json: async () => ({ error: { message: 'nope' } }),
      }
    })
    const failed = await post({}, { 'idempotency-key': 'attempt-e' })
    expect(failed.status).toBe(502)
    expect(claimDocs()).toHaveLength(0)

    const retry = await post({}, { 'idempotency-key': 'attempt-e' })
    expect(retry.status).toBe(200)
    expect(sessionCalls()).toHaveLength(2)
    expect(sessionCalls()[1].idempotencyKey).toBe(
      sessionCalls()[0].idempotencyKey,
    )
  })

  /**
   * Backwards compatibility: an older cached storefront bundle sends no key
   * and must keep buying — deduping nothing, exactly as before.
   */
  it('still buys without a key, and dedupes nothing', async () => {
    await post()
    await post()
    expect(sessionCalls()).toHaveLength(2)
    expect(claimDocs()).toHaveLength(0)
    expect(sessionCalls()[0].idempotencyKey).toBeNull()
  })
})
