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
 * A TEST-MODE CONNECT ACCOUNT CANNOT READ AS PAYMENTS-READY (AGL-2471).
 *
 * Production Firestore held three Connect linkages and every one of them named
 * a TEST-mode account. `profiles/7AVEMtDa6OR1EuEspeLTx2xj7gg1` also carried
 * `stripeChargesEnabled: true`, and that field alone was the whole readiness
 * test at every money door:
 *
 *     if (!accountId || !ownerProfile.get('stripeChargesEnabled')) …
 *
 * So its three storefronts presented as ready, minted a LIVE Checkout session
 * naming a TEST-mode `transfer_data[destination]`, and were refused by Stripe
 * as a generic 502 in front of the shopper.
 *
 * THIS FILE ASSERTS AT THE STRIPE BOUNDARY, like the AGL-2152 margin suite
 * beside it: the question is not whether a helper returns the right enum, it
 * is whether the storefront's shopper-facing door STOPS — no session created,
 * no destination sent. A gate that exists and is not consulted is this repo's
 * most repeated failure, and only the boundary can tell the two apart.
 *
 * The unit-level truth table lives in
 * `libs/tenant/data/admin/src/lib/server/stripe-account-mode.spec.ts`; the
 * seven doors that must all consult it are enumerated in
 * `connect-mode-gate-coverage.spec.ts`.
 *
 * Stripe is mocked absolutely — localhost carries the LIVE secret key.
 */

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { checkoutHandler } from './checkout'

// ---------------------------------------------------------------------------
// In-memory Firestore — the smallest fake this handler can run against
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()

function writeDoc(path: string, value: Record<string, any>, merge: boolean) {
  docs.set(path, merge ? { ...(docs.get(path) ?? {}), ...value } : value)
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
    set: async (value: Record<string, any>, options?: { merge?: boolean }) =>
      writeDoc(path, value, Boolean(options?.merge)),
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
    get: async () => ({ docs: [] as unknown[] }),
  }
}

async function runTransaction(body: (t: any) => Promise<any>): Promise<any> {
  const writes: Array<[string, Record<string, any>, boolean]> = []
  const transaction = {
    get: async (ref: any) => makeSnapshot(ref.path),
    set: (ref: any, value: Record<string, any>, options?: any) =>
      writes.push([ref.path, value, Boolean(options?.merge)]),
    update: (ref: any, value: Record<string, any>) =>
      writes.push([ref.path, value, true]),
  }
  const result = await body(transaction)
  for (const [path, value, merge] of writes) writeDoc(path, value, merge)
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

// Only Firestore is faked. The gate is NOT mocked — it reaches the handler
// through `@aglyn/tenant-data-admin/server/stripe-account-mode`, a pure module
// with no Firebase dependency, so the REAL decision runs. That separation is
// deliberate: a gate mocked out of the path proves nothing about the path.
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
        id: 'cs_1',
        url: 'https://checkout.stripe.com/pay/cs_1',
      }),
    }
  }
  throw new Error(`Unexpected Stripe endpoint ${target}`)
})

function makeResponse() {
  const result = { status: 0, body: undefined as any }
  const res = {
    status(code: number) {
      result.status = code
      return res
    },
    json(body: unknown) {
      result.body = body
    },
    send(body: unknown) {
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
  } as unknown as PluginApiResponse
  return { res, result }
}

interface Scenario {
  /** Whatever the profile document actually holds for the linkage. */
  profile: Record<string, unknown>
  /** The deployment's key — `sk_live_…` in production. */
  secretKey: string
}

/** Seeds a host that can sell one $30 digital product, then buys it. */
async function runCheckout(scenario: Scenario) {
  process.env.STRIPE_SECRET_KEY = scenario.secretKey
  docs.clear()
  docs.set('hosts/host-1', { name: 'Acme' })
  docs.set('profiles/owner-1', scenario.profile)
  docs.set('hosts/host-1/products/p1', {
    name: 'Guide',
    status: 'active',
    type: 'digital',
    variants: [{ id: 'v1', priceUsd: 30, inventory: 100 }],
  })
  docs.set('hosts/host-1/settings/store', { tax: { mode: 'none' } })
  sessionBody = null
  const { res, result } = makeResponse()
  const req = {
    method: 'POST',
    body: { hostId: 'host-1', productId: 'p1', variantId: 'v1', quantity: 1 },
    cookies: {},
    headers: { host: 'shop.example.com' },
    query: {},
  } as unknown as PluginApiRequest
  await checkoutHandler(req, res)
  return { result, body: sessionBody as URLSearchParams | null }
}

/** The production record, verbatim. */
const POISONED = {
  stripeAccountId: 'acct_1TulDeRbL3B9Ioqz',
  stripeChargesEnabled: true,
}

const LIVE_KEY = 'sk_live_platform'
const TEST_KEY = 'sk_test_platform'

let errorSpy: jest.SpyInstance

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch
})

beforeEach(() => {
  fetchMock.mockClear()
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  errorSpy.mockRestore()
})

describe('storefront checkout refuses an unverified Connect linkage', () => {
  it('refuses the production record, and creates NO Stripe session', async () => {
    const { result, body } = await runCheckout({
      profile: POISONED,
      secretKey: LIVE_KEY,
    })
    expect(result.status).toBe(409)
    // The boundary assertion. Before AGL-2471 this session WAS created, with
    // `transfer_data[destination]=acct_1TulDeRbL3B9Ioqz` on a live key, and
    // Stripe refused it in front of the shopper.
    expect(body).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    // The cause is named somewhere a human can find it — the shopper's 409
    // cannot carry it.
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('AGL-2471')
  })

  it('refuses a linkage explicitly recorded as test-mode under a live key', async () => {
    const { result, body } = await runCheckout({
      profile: { ...POISONED, stripeAccountLivemode: false },
      secretKey: LIVE_KEY,
    })
    expect(result.status).toBe(409)
    expect(body).toBeNull()
  })

  // ---- Positive controls. Without these the assertions above are satisfied
  // ---- by a handler that refuses everything, which is not a fix.

  it('SELLS when the linkage is verified live and the key is live', async () => {
    const { result, body } = await runCheckout({
      profile: { ...POISONED, stripeAccountLivemode: true },
      secretKey: LIVE_KEY,
    })
    expect(result.status).toBe(200)
    expect(body).not.toBeNull()
    expect(body?.get('payment_intent_data[transfer_data][destination]')).toBe(
      'acct_1TulDeRbL3B9Ioqz',
    )
  })

  it('SELLS a test-mode linkage under a test key — test mode is not broken', async () => {
    // The dev/staging path. A mode CHECK that refused test mode everywhere
    // would break every non-production deployment, so the gate compares the
    // two modes rather than preferring one.
    const { result, body } = await runCheckout({
      profile: { ...POISONED, stripeAccountLivemode: false },
      secretKey: TEST_KEY,
    })
    expect(result.status).toBe(200)
    expect(body).not.toBeNull()
  })

  it('still refuses a merchant Stripe has restricted', async () => {
    // The pre-existing refusal survives, and is asked BEFORE the mode
    // question — a restricted merchant is not told their account is
    // unverified.
    const { result } = await runCheckout({
      profile: {
        stripeAccountId: 'acct_1',
        stripeChargesEnabled: false,
        stripeAccountLivemode: true,
      },
      secretKey: LIVE_KEY,
    })
    expect(result.status).toBe(409)
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
