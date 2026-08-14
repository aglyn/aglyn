/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
 *
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
 * Enterprise provisioning must not bill a negotiated deal twice (AGL-1714).
 *
 * The ninth unkeyed Stripe site, and the only one where a plain retry creates a
 * live subscription with no buyer interaction at all. `mode: 'invoice'` — the
 * DEFAULT, since anything that is not literally `'checkout'` falls through to
 * it — posts `/v1/subscriptions` with `collection_method: send_invoice` and
 * `days_until_due: 30`. There is no Checkout session for anyone to abandon: the
 * subscription exists the moment the call returns, so a double-submit bills an
 * enterprise customer twice on net-30 and the second invoice may not surface
 * for weeks.
 *
 * Every attempt also posts `/v1/prices` unconditionally, so each retry strands a
 * duplicate custom Price on the live account carrying identical
 * `metadata[orgId]` / `metadata[plan]` / `metadata[custom]` — indistinguishable
 * from its twin in the dashboard, and nothing ever cleans them up.
 *
 * Two layers under test, and the distinction is the design:
 *
 * - The CLAIM covers a retry of one attempt (double-click, lost response,
 *   client timeout).
 * - The LIVE-SUBSCRIPTION RULE covers a deliberate second provisioning an hour
 *   later, which carries a different attempt key and is indistinguishable from
 *   a first one. A key would say nothing about it.
 *
 * Counting, not trusting: every assertion counts the Stripe calls that actually
 * left the handler, and the claim documents that actually landed. `fetch` is
 * mocked for the whole file so nothing can reach api.stripe.com — localhost
 * carries the LIVE Stripe key. The claim is the REAL `claimAttempt` over an
 * in-memory Firestore, not a stub; its atomicity is the thing under test.
 */

// A module, not a script — without this the const declarations below collide
// with the other console billing route specs' identical globals under `tsc`.
export {}

const mockVerifyIdToken = jest.fn()
const mockReadOrgBilling = jest.fn()
const mockWriteOrgBilling = jest.fn()

/** Every document the handler wrote, keyed by `collection/id`. */
let docs = new Map<string, Record<string, unknown>>()

/**
 * In-memory Firestore, enough for the real `claimAttempt` plus the org read,
 * the optimistic plan mirror and the audit append.
 *
 * `create()` rejects on an existing document, which is the whole dedupe
 * primitive — stubbing that away would make every concurrency assertion here
 * vacuous.
 */
function mockMakeFirestore() {
  const doc = (path: string) => ({
    id: path.split('/').pop(),
    create: async (data: Record<string, unknown>) => {
      if (docs.has(path)) throw new Error('ALREADY_EXISTS')
      docs.set(path, { ...data })
      return undefined
    },
    get: async () => ({
      exists: docs.has(path),
      data: () => docs.get(path),
      get: (field: string) => (docs.get(path) ?? {})[field],
    }),
    set: async (data: Record<string, unknown>, options?: { merge: boolean }) => {
      docs.set(path, options?.merge ? { ...docs.get(path), ...data } : { ...data })
      return undefined
    },
    delete: async () => {
      docs.delete(path)
      return undefined
    },
  })
  return {
    collection: (name: string) => ({
      doc: (id: string) => doc(`${name}/${id}`),
      add: async (data: Record<string, unknown>) => {
        docs.set(`${name}/auto-${docs.size}`, { ...data })
        return { id: `auto-${docs.size}` }
      },
    }),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => mockMakeFirestore(),
    }),
    firestore: { FieldValue: { serverTimestamp: () => 'ts' } },
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  readOrgBilling: (...args: unknown[]) => mockReadOrgBilling(...args),
  writeOrgBilling: (...args: unknown[]) => mockWriteOrgBilling(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL claim — the point of the exercise is that this route reuses the
  // shared implementation rather than growing a fourth copy of it.
  claimAttempt: jest.requireActual('@aglyn/aglyn/app-utils/api-idempotency')
    .claimAttempt,
  // The real predicate too — a stub here would let the status semantics drift
  // out from under the CANCELED and `unpaid` controls below.
  isOrgSubscriptionLive: jest.requireActual('@aglyn/aglyn/app-utils/org-billing-doc')
    .isOrgSubscriptionLive,
  PLAN_PRICING: {
    free: { monthly: 0 },
    starter: { monthly: 19 },
    pro: { monthly: 49 },
    enterprise: { monthly: 0 },
  },
  pluginRequestFromWeb: async (request: Request) => {
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })
    return {
      method: request.method,
      body: await request.json(),
      headers: { ...headers, origin: 'https://app.aglyn.com' },
    }
  },
}))

/** Env without a trace of the developer's own Stripe config (`nx test` leaks the root env). */
const CLEAN_ENV = (() => {
  const clean = { ...process.env }
  for (const key of Object.keys(clean)) {
    if (key.startsWith('STRIPE_') || key.startsWith('NEXT_PUBLIC_STRIPE_')) {
      delete clean[key]
    }
  }
  return clean
})()

const ORIGINAL_ENV = process.env

/** Every Stripe call the handler actually made. */
interface StripeCall {
  url: string
  params: URLSearchParams
  idempotencyKey: string | null
}
let calls: StripeCall[] = []

/** Per-endpoint overrides: return `null` to throw instead of responding. */
let stripeFaults: Record<string, { ok: boolean; body?: unknown } | null> = {}

function callsTo(fragment: string) {
  return calls.filter((call) => call.url.includes(fragment))
}

/** Claim documents currently held — the `apiIdempotency` collection. */
function claimDocs() {
  return [...docs.keys()].filter((key) => key.startsWith('apiIdempotency/'))
}

function loadRoute() {
  jest.resetModules()
  process.env = {
    ...CLEAN_ENV,
    STRIPE_SECRET_KEY: 'sk_test_fake',
  } as NodeJS.ProcessEnv
  return require('../app/api/admin/enterprise-billing/route').POST as (
    request: Request,
  ) => Promise<Response>
}

function provision(
  post: (request: Request) => Promise<Response>,
  options: {
    key?: string
    mode?: 'invoice' | 'checkout'
    plan?: string
    amountMonthlyUsd?: number
  } = {},
) {
  const {
    key = 'attempt-1',
    mode = 'invoice',
    plan = 'enterprise',
    amountMonthlyUsd = 4000,
  } = options
  return post(
    new Request('https://app.aglyn.com/api/admin/enterprise-billing', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
        ...(key ? { 'idempotency-key': key } : {}),
      },
      body: JSON.stringify({
        orgId: 'org-1',
        amountMonthlyUsd,
        interval: 'month',
        plan,
        mode,
      }),
    }),
  )
}

beforeEach(() => {
  calls = []
  stripeFaults = {}
  docs = new Map()
  // `restoreAllMocks` does not reset a bare `jest.fn()`'s call history, and the
  // mirror-write assertion below counts calls rather than inspecting them.
  mockVerifyIdToken.mockClear()
  mockReadOrgBilling.mockClear()
  mockWriteOrgBilling.mockClear()
  docs.set('orgs/org-1', { displayName: 'Acme Corp', plan: 'free' })
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email: 'staff@aglyn.com',
    email_verified: true,
    staff: true,
  })
  // An enterprise org that has never billed: no live subscription in the way.
  mockReadOrgBilling.mockResolvedValue({ stripeCustomerId: 'cus_ent_1' })
  mockWriteOrgBilling.mockResolvedValue(undefined)
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    const href = String(url)
    for (const [fragment, fault] of Object.entries(stripeFaults)) {
      if (!href.includes(fragment)) continue
      if (fault === null) throw new Error('network reset')
      calls.push({
        url: href,
        params: new URLSearchParams(String(init?.body ?? '')),
        idempotencyKey: init?.headers?.['Idempotency-Key'] ?? null,
      })
      return { ok: fault.ok, status: fault.ok ? 200 : 402, json: async () => fault.body }
    }
    calls.push({
      url: href,
      params: new URLSearchParams(String(init?.body ?? '')),
      idempotencyKey: init?.headers?.['Idempotency-Key'] ?? null,
    })
    // `products/search` is a GET and must find nothing, so the product is
    // created once and reused — the Price and the subscription are the objects
    // under test.
    if (href.includes('products/search')) return { ok: true, json: async () => ({ data: [] }) }
    if (href.includes('/products')) return { ok: true, json: async () => ({ id: 'prod_1' }) }
    if (href.includes('/prices')) {
      return { ok: true, json: async () => ({ id: `price_${callsTo('/prices').length}` }) }
    }
    if (href.includes('checkout/sessions')) {
      return {
        ok: true,
        json: async () => ({
          id: `cs_${callsTo('checkout/sessions').length}`,
          url: `https://checkout.stripe.com/c/session-${callsTo('checkout/sessions').length}`,
        }),
      }
    }
    if (href.includes('/subscriptions')) {
      return {
        ok: true,
        json: async () => ({
          id: `sub_${callsTo('/subscriptions').length}`,
          status: 'active',
          current_period_end: 1800000000,
          latest_invoice: { hosted_invoice_url: 'https://invoice.stripe.com/i/1' },
        }),
      }
    }
    return { ok: true, json: async () => ({ id: 'obj_1' }) }
  }) as never
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  jest.restoreAllMocks()
})

describe('enterprise provisioning is idempotent (AGL-1714)', () => {
  it('THE DEFECT: a retried invoice provisioning bills the customer TWICE on net-30', async () => {
    const post = loadRoute()
    const first = await provision(post)
    const second = await provision(post)

    expect(first.status).toBe(200)
    // The measurement that matters: one subscription on the live account, not
    // two. `send_invoice` means the second one is a real second net-30 invoice.
    expect(callsTo('/subscriptions')).toHaveLength(1)
    // …and one custom Price, not a duplicate pair nothing ever cleans up.
    expect(callsTo('/prices')).toHaveLength(1)
    // The repeat replays the first attempt's answer rather than refusing it.
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual(await first.json())
  })

  it('THE DEFECT: two CONCURRENT submits of one attempt open two subscriptions', async () => {
    const post = loadRoute()
    const [a, b] = await Promise.all([provision(post), provision(post)])

    expect(callsTo('/subscriptions')).toHaveLength(1)
    expect(callsTo('/prices')).toHaveLength(1)
    // One wins; the loser is refused rather than let through, because letting
    // it through IS the duplicate charge.
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([200, 409])
  })

  it('sends Stripe an Idempotency-Key on the Price AND the subscription, and they DIFFER', async () => {
    const post = loadRoute()
    await provision(post)

    const priceKey = callsTo('/prices')[0]?.idempotencyKey
    const subscriptionKey = callsTo('/subscriptions')[0]?.idempotencyKey
    expect(priceKey).toBeTruthy()
    expect(subscriptionKey).toBeTruthy()
    // Stripe's idempotency layer is account-scoped, not endpoint-scoped: it
    // "compares incoming parameters to those of the original request and errors
    // if they're not the same". One digest on both calls would make the second
    // fail outright, so each call carries its own derivation of it.
    expect(priceKey).not.toBe(subscriptionKey)
    // No key on the GET — Stripe documents them as having no effect there.
    expect(callsTo('products/search')[0]?.idempotencyKey).toBeNull()
  })

  it('checkout mode replays the SAME link instead of minting a second session', async () => {
    const post = loadRoute()
    const first = await provision(post, { mode: 'checkout' })
    const second = await provision(post, { mode: 'checkout' })

    expect(callsTo('checkout/sessions')).toHaveLength(1)
    expect(callsTo('/prices')).toHaveLength(1)
    expect((await second.json()).checkoutUrl).toBe((await first.json()).checkoutUrl)
  })
})

describe('one org, one subscription (AGL-1714)', () => {
  it('THE DEFECT: provisioning enterprise over a LIVE subscription adds a second one', async () => {
    mockReadOrgBilling.mockResolvedValue({
      stripeCustomerId: 'cus_ent_1',
      subscription: { status: 'active', priceId: 'price_selfserve' },
    })
    const post = loadRoute()
    const response = await provision(post)

    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('subscription_exists')
    // Nothing was minted on the live account — not a Price, not a subscription.
    expect(calls).toHaveLength(0)
    // And the optimistic mirror did not overwrite the existing subscription
    // record, which is the only local evidence the first one exists.
    expect(mockWriteOrgBilling).not.toHaveBeenCalled()
  })

  it('refuses trialing and past_due too', async () => {
    for (const status of ['trialing', 'past_due']) {
      calls = []
      docs = new Map([['orgs/org-1', { displayName: 'Acme Corp', plan: 'free' }]])
      mockReadOrgBilling.mockResolvedValue({
        stripeCustomerId: 'cus_ent_1',
        subscription: { status },
      })
      const post = loadRoute()
      const response = await provision(post)
      expect(`${status} → ${response.status} / ${calls.length}`).toBe(
        `${status} → 409 / 0`,
      )
    }
  })

  it('CONTROL — a CANCELED org can be provisioned again', async () => {
    // The case a naive "has a subscription record" guard would break: the
    // record and `stripeCustomerId` both survive cancellation, so the naive
    // form would lock every churned enterprise org out of ever paying again.
    mockReadOrgBilling.mockResolvedValue({
      stripeCustomerId: 'cus_ent_1',
      subscription: { status: 'canceled', priceId: 'price_old' },
    })
    const post = loadRoute()
    expect((await provision(post)).status).toBe(200)
    expect(callsTo('/subscriptions')).toHaveLength(1)
  })

  it('CONTROL — incomplete and unpaid do not lock an org out', async () => {
    for (const status of ['incomplete', 'incomplete_expired', 'unpaid']) {
      calls = []
      docs = new Map([['orgs/org-1', { displayName: 'Acme Corp', plan: 'free' }]])
      mockReadOrgBilling.mockResolvedValue({ subscription: { status } })
      const post = loadRoute()
      const response = await provision(post)
      expect(`${status} → ${response.status}`).toBe(`${status} → 200`)
    }
  })
})

describe('claim-release semantics (AGL-1714)', () => {
  it('CONTROL — a DIFFERENT key provisions a real second attempt', async () => {
    // The case that would fail if the key were ever derived from the request
    // contents. A renegotiated deal at the same figure is a real second
    // provisioning, and de-duplicating it would be a worse bug than this one.
    const post = loadRoute()
    await provision(post, { key: 'attempt-1' })
    await provision(post, { key: 'attempt-2' })
    expect(callsTo('/subscriptions')).toHaveLength(2)
  })

  it('CONTROL — no key at all still provisions, and dedupes nothing', async () => {
    // An older cached console bundle must not start failing provisioning.
    const post = loadRoute()
    await provision(post, { key: '' })
    await provision(post, { key: '' })
    expect(callsTo('/subscriptions')).toHaveLength(2)
    expect(claimDocs()).toHaveLength(0)
    expect(callsTo('/subscriptions')[0].idempotencyKey).toBeNull()
  })

  it('a DETERMINISTIC Stripe refusal releases the key, and the retry reuses it', async () => {
    // Stripe answered, so we KNOW nothing was created. Staff fixes the figure
    // and presses the same button — and because the released key re-derives the
    // SAME digest, Stripe replays the first Price rather than minting a twin.
    stripeFaults = {
      '/prices': { ok: false, body: { error: { message: 'Invalid amount' } } },
    }
    const post = loadRoute()
    expect((await provision(post)).status).toBe(502)
    expect(claimDocs()).toHaveLength(0)

    stripeFaults = {}
    expect((await provision(post)).status).toBe(200)
    expect(callsTo('/prices')).toHaveLength(2)
    expect(callsTo('/prices')[0].idempotencyKey).toBe(
      callsTo('/prices')[1].idempotencyKey,
    )
  })

  it('an UNKNOWN outcome strands the key deliberately — the retry 409s', async () => {
    // The asymmetry that decides this: the subscription may or may not exist on
    // Stripe. A stranded key costs a reload and a look at the dashboard; a
    // released one costs a second four-figure net-30 invoice.
    stripeFaults = { '/subscriptions': null }
    const post = loadRoute()
    expect((await provision(post)).status).toBe(500)
    expect(claimDocs()).toHaveLength(1)

    stripeFaults = {}
    const retry = await provision(post)
    expect(retry.status).toBe(409)
    expect(callsTo('/subscriptions')).toHaveLength(0)
  })

  it('CONTROL — a deterministic refusal ABOVE the claim does not burn the key', async () => {
    const post = loadRoute()
    expect((await provision(post, { plan: 'free' })).status).toBe(400)
    expect(claimDocs()).toHaveLength(0)
    expect(calls).toHaveLength(0)
    // Same key still works once the input is fixed.
    expect((await provision(post)).status).toBe(200)
  })
})
