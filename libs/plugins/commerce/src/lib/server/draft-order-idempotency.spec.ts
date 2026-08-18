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
import { draftOrderHandler } from './draft-order'

/**
 * Draft-order idempotency (AGL-1697, item 1).
 *
 * The costliest retry in the survey: this handler creates an order document
 * with a sequential number AND a Stripe payment link bound to that document, so
 * before the claim a double-submit minted a second order, burned a second
 * order number, and handed the merchant TWO live payment links the buyer can
 * both pay.
 *
 * The boundary that matters is Stripe, mocked absolutely: `global.fetch` is
 * replaced for the whole file and every call is counted. Nothing here may
 * reach api.stripe.com — localhost carries the LIVE secret key. Firestore is
 * an in-memory map so the tests COUNT the `orders` documents that actually
 * landed rather than trusting the handler's response.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore (pos-order.spec.ts shape)
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
  runTransaction: async (fn: (transaction: any) => Promise<void>) =>
    fn({
      get: (ref: any) => ref.get(),
      set: (ref: any, value: any, options?: any) => {
        void ref.set(value, options)
      },
    }),
}

const mockVerifyIdToken = jest.fn(async () => ({
  uid: 'manager-1',
  email: 'manager@example.com',
}))
const mockOrg: any = {
  org: {
    id: 'org-1',
    plan: 'business',
    // The org doc's real status field is `billingStatus` — the bare mirror
    // `writeOrgBilling` writes back for the dunning banner, and the one
    // `subscriptionStatusOf` reads on an org doc (the live `subscription`
    // object lives under `orgs/{orgId}/billing/stripe`, which
    // `getOrgForHost` does not return). A fixture keyed `subscriptionStatus`
    // is read by nothing, so a dead-subscription case written against it
    // silently resolves as ACTIVE.
    billingStatus: 'active',
    ownerUid: 'owner-1',
    slug: 'acme',
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: any[]) => mockVerifyIdToken(...(args as [])),
      }),
      firestore: () => fakeFirestore,
    }),
    firestore: {
      FieldValue: { serverTimestamp: () => '<server-timestamp>' },
    },
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
/** Keyed sessions, mirroring Stripe's own replay-for-a-repeated-key. */
const stripeSessionsByKey = new Map<string, { id: string; url: string }>()
let stripeSessionCounter = 0

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
  if (idempotencyKey && stripeSessionsByKey.has(idempotencyKey)) {
    return {
      ok: true,
      json: async () => stripeSessionsByKey.get(idempotencyKey),
    }
  }
  const session = {
    id: `cs_${++stripeSessionCounter}`,
    url: `https://checkout.stripe.com/pay/session-${stripeSessionCounter}`,
  }
  if (idempotencyKey) stripeSessionsByKey.set(idempotencyKey, session)
  return { ok: true, json: async () => session }
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

function makeRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): PluginApiRequest {
  return {
    method: 'POST',
    query: {},
    body: { hostId: 'host-1', productId: 'product-1', quantity: 1, ...body },
    headers: {
      authorization: 'Bearer token',
      host: 'acme.aglyn.app',
      ...headers,
    },
    cookies: {},
    socket: {},
  } as PluginApiRequest
}

async function post(
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const { res, result } = makeResponse()
  await draftOrderHandler(makeRequest(body, headers), res)
  return result
}

function orderDocs() {
  return childPaths('hosts/host-1/orders').map((path) => docs.get(path))
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
  stripeSessionsByKey.clear()
  autoIdCounter = 0
  stripeSessionCounter = 0
  fetchMock.mockClear()
  mockVerifyIdToken.mockClear()

  docs.set('hosts/host-1', { memberRoles: { 'manager-1': 'manager' } })
  docs.set('hosts/host-1/products/product-1', {
    name: 'Walnut desk',
    type: 'physical',
    status: 'active',
    variants: [{ id: 'default', priceUsd: 900, inventory: null }],
  })
  // AGL-1999: "no tax" is now an explicit decision, not an absent doc.
  docs.set('hosts/host-1/settings/store', { tax: { mode: 'none' } })
  docs.set('profiles/owner-1', {
    stripeAccountId: 'acct_live_merchant',
    stripeChargesEnabled: true,
  })
  docs.set('hostIndex/host-1', { subdomain: 'acme-shop' })
})

// ---------------------------------------------------------------------------

describe('draft-order idempotency (AGL-1697)', () => {
  it('creates one draft with a payment link and records the claim', async () => {
    const result = await post({}, { 'idempotency-key': 'attempt-a' })
    expect(result.status).toBe(200)
    expect(result.body.url).toContain('checkout.stripe.com')
    expect(orderDocs()).toHaveLength(1)
    expect(stripeCalls).toHaveLength(1)
    // The recorded claim is what a later retry replays from.
    expect(claimDocs()).toHaveLength(1)
    expect(docs.get(claimDocs()[0])?.['status']).toBe('done')
  })

  /**
   * THE DEFECT. Same draft, same attempt key, posted twice — a double-click or
   * a lost response. Before the fix this returned two order documents, burned
   * two sequential numbers, and produced TWO live payment links bound to
   * DIFFERENT orders, both of which the buyer could pay.
   */
  it('replays a retried draft instead of minting a second payment link', async () => {
    const first = await post({}, { 'idempotency-key': 'attempt-a' })
    const second = await post({}, { 'idempotency-key': 'attempt-a' })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    // One order document, one consumed order number.
    expect(orderDocs()).toHaveLength(1)
    expect((orderDocs()[0] as any).number).toBe(1)
    // One Stripe session — the half that is a live payment link.
    expect(stripeCalls).toHaveLength(1)
    // The merchant's clipboard keeps pointing at the order that exists.
    expect(second.body.url).toBe(first.body.url)
    expect(second.body.orderId).toBe(first.body.orderId)
  })

  /**
   * The other half of correctness: the same merchant invoicing the same buyer
   * for the same desk again is a REAL second order. Distinct attempt keys must
   * produce distinct orders — a content-derived key would swallow this.
   */
  it('creates a genuinely new draft under a fresh attempt key', async () => {
    const first = await post({}, { 'idempotency-key': 'attempt-a' })
    const second = await post({}, { 'idempotency-key': 'attempt-b' })
    expect(orderDocs()).toHaveLength(2)
    expect(second.body.orderId).not.toBe(first.body.orderId)
    expect(stripeCalls).toHaveLength(2)
  })

  /**
   * Stripe's own idempotency is the backstop for the window where our claim
   * landed but the process died before recording the response — the session
   * must carry a key derived from the attempt, stable across a re-run.
   */
  it('hands Stripe an idempotency key derived from the attempt', async () => {
    await post({}, { 'idempotency-key': 'attempt-a' })
    expect(stripeCalls[0].idempotencyKey).toBeTruthy()

    docs.delete(claimDocs()[0] ?? 'apiIdempotency/none')
    await post({}, { 'idempotency-key': 'attempt-a' })
    expect(stripeCalls).toHaveLength(2)
    expect(stripeCalls[1].idempotencyKey).toBe(stripeCalls[0].idempotencyKey)
    // Stripe replayed rather than opening a second session.
    expect(stripeSessionsByKey.size).toBe(1)
  })

  /**
   * A deterministic rejection must not burn the key: an unknown product is a
   * 404 the merchant fixes by picking a real one and pressing the same button.
   */
  it('does not burn the key on a validation rejection', async () => {
    const refused = await post(
      { productId: 'ghost' },
      { 'idempotency-key': 'attempt-c' },
    )
    expect(refused.status).toBe(404)
    expect(claimDocs()).toHaveLength(0)

    const retry = await post({}, { 'idempotency-key': 'attempt-c' })
    expect(retry.status).toBe(200)
    expect(orderDocs()).toHaveLength(1)
  })

  /**
   * A failed Stripe call already deleted the order doc; it must release the
   * claim too, or one flaky moment locks this draft out forever.
   */
  it('releases the claim when the payment link fails', async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      json: async () => ({ error: { message: 'nope' } }),
    }))
    const failed = await post({}, { 'idempotency-key': 'attempt-d' })
    expect(failed.status).toBe(502)
    expect(orderDocs()).toHaveLength(0)
    expect(claimDocs()).toHaveLength(0)

    const retry = await post({}, { 'idempotency-key': 'attempt-d' })
    expect(retry.status).toBe(200)
    expect(orderDocs()).toHaveLength(1)
  })

  /**
   * Backwards compatibility: an older cached console bundle sends no key and
   * must keep creating drafts — deduping nothing, exactly as before.
   */
  it('still drafts without a key, and dedupes nothing', async () => {
    await post()
    await post()
    expect(orderDocs()).toHaveLength(2)
    expect(stripeCalls).toHaveLength(2)
    expect(claimDocs()).toHaveLength(0)
    expect(stripeCalls[0].idempotencyKey).toBeNull()
  })
})

/**
 * AGL-1873: the commerce entitlement is re-asked per request, the AGL-481
 * pattern — a downgrade takes effect at the next draft, not never. Before
 * the gate, a free/lapsed org's admin could mint live payment links at the
 * free plan's 0% transaction fee.
 */
describe('the commerce entitlement gates the draft door (AGL-1873)', () => {
  afterEach(() => {
    mockOrg.org.plan = 'business'
    mockOrg.org.billingStatus = 'active'
  })

  it('a free-plan org is refused before Stripe and before any order doc', async () => {
    mockOrg.org.plan = 'free'
    const result = await post({}, { 'idempotency-key': 'attempt-entitlement' })
    expect(result.status).toBe(403)
    expect(stripeCalls).toHaveLength(0)
    expect(orderDocs()).toHaveLength(0)
  })

  it('a dead subscription on a paid plan is refused too — the sticky-downgrade half', async () => {
    mockOrg.org.billingStatus = 'canceled'
    const result = await post({}, { 'idempotency-key': 'attempt-entitlement-2' })
    expect(result.status).toBe(403)
    expect(stripeCalls).toHaveLength(0)
  })

  it('the refusal does not burn the attempt key', async () => {
    mockOrg.org.plan = 'free'
    const refused = await post({}, { 'idempotency-key': 'attempt-back' })
    expect(refused.status).toBe(403)
    mockOrg.org.plan = 'business'
    const retry = await post({}, { 'idempotency-key': 'attempt-back' })
    expect(retry.status).toBe(200)
    expect(orderDocs()).toHaveLength(1)
  })
})
