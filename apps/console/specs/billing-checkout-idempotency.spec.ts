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
 * The console subscription checkout gets its idempotency key (AGL-1697,
 * item 3's second half).
 *
 * The first half — the `subscription_exists` status guard — landed in
 * `17b0628c3` and covers a SEQUENTIAL duplicate: by the time the second
 * session completes, the webhook has mirrored the first and the guard refuses.
 * What it cannot cover is the window before any subscription exists: a
 * double-click or a lost response opened two sessions for the same org, and
 * two completed sessions subscribed it twice on the same customer.
 *
 * Counting, not trusting: every assertion counts the Stripe calls that left
 * the handler and the claim docs that landed. `fetch` is mocked for the whole
 * file — nothing may reach api.stripe.com, and the env is scrubbed of the
 * developer's own STRIPE_* config because `nx test` leaks the root .env,
 * which on localhost carries the LIVE secret key.
 */

// A module, not a script — without this the const declarations below collide
// with the other console billing route specs' identical globals under `tsc`.
export {}

const mockVerifyIdToken = jest.fn()
const mockReadOrgBilling = jest.fn()

/** Every document the handler wrote, keyed by `collection/id`. */
let docs = new Map<string, Record<string, unknown>>()

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
  featureLockdownRefusal: async () => null,
  getServerReleaseFlagValues: async () => ({}),
  memberHasOrgPermission: async () => true,
  resolveOrgMembership: async (_uid: string, orgId: string | null) => ({
    orgId: orgId ?? 'org-1',
    member: { role: 'owner' },
  }),
  readOrgBilling: (...args: unknown[]) => mockReadOrgBilling(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The route's util chain (billing-addons) reads the real plan constants —
  // PLAN_PRICING, SELF_SERVE_PLANS, the addon rates — so the real module
  // backs the mock rather than a parallel copy of the price list.
  ...jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements'),
  // The REAL claim — the point is that this route reuses the shared
  // implementation rather than growing another copy.
  claimAttempt: jest.requireActual('@aglyn/aglyn/app-utils/api-idempotency')
    .claimAttempt,
  // The real predicate too, so the pre-claim subscription_exists control
  // below cannot drift out from under the status semantics.
  isOrgSubscriptionLive: jest.requireActual(
    '@aglyn/aglyn/app-utils/org-billing-doc',
  ).isOrgSubscriptionLive,
  isCustomPricedPlan: (plan: string) => plan === 'enterprise',
  isReleaseFlagOn: () => false,
  buildRoute: () => '/acme/manage/billing',
  Route: { MANAGE_BILLING: '/manage/billing' },
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

interface StripeCall {
  url: string
  params: URLSearchParams
  idempotencyKey: string | null
}
let calls: StripeCall[] = []
/** Set to fail the next session call; cleared per test. */
let stripeFault: { ok: boolean; body?: unknown } | null = null
/** Keyed replays, mirroring Stripe's own idempotency layer. */
let sessionsByKey = new Map<string, unknown>()
let sessionCounter = 0

function claimDocs() {
  return [...docs.keys()].filter((key) => key.startsWith('apiIdempotency/'))
}

function loadRoute() {
  jest.resetModules()
  process.env = {
    ...CLEAN_ENV,
    STRIPE_SECRET_KEY: 'sk_test_fake',
    STRIPE_PRICE_PRO: 'price_pro_month',
  } as NodeJS.ProcessEnv
  return require('../app/api/billing/checkout/route').POST as (
    request: Request,
  ) => Promise<Response>
}

function upgrade(
  post: (request: Request) => Promise<Response>,
  options: { key?: string; plan?: string } = {},
) {
  const { key = 'attempt-1', plan = 'pro' } = options
  return post(
    new Request('https://app.aglyn.com/api/billing/checkout', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
        ...(key ? { 'idempotency-key': key } : {}),
      },
      body: JSON.stringify({ plan, interval: 'month', orgId: 'org-1' }),
    }),
  )
}

beforeEach(() => {
  calls = []
  stripeFault = null
  sessionsByKey = new Map()
  sessionCounter = 0
  docs = new Map()
  mockVerifyIdToken.mockClear()
  mockReadOrgBilling.mockClear()
  docs.set('orgs/org-1', { slug: 'acme', plan: 'free' })
  mockVerifyIdToken.mockResolvedValue({
    uid: 'owner-1',
    email: 'owner@acme.com',
    email_verified: true,
  })
  // A free org that has never billed: nothing in the guard's way.
  mockReadOrgBilling.mockResolvedValue({})
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    const href = String(url)
    const idempotencyKey =
      (init?.headers?.['Idempotency-Key'] as string | undefined) ?? null
    calls.push({
      url: href,
      params: new URLSearchParams(String(init?.body ?? '')),
      idempotencyKey,
    })
    if (stripeFault) {
      const fault = stripeFault
      stripeFault = null
      return { ok: fault.ok, status: 402, json: async () => fault.body }
    }
    if (idempotencyKey && sessionsByKey.has(idempotencyKey)) {
      return { ok: true, json: async () => sessionsByKey.get(idempotencyKey) }
    }
    const payload = {
      id: `cs_${++sessionCounter}`,
      url: `https://checkout.stripe.com/c/session-${sessionCounter}`,
    }
    if (idempotencyKey) sessionsByKey.set(idempotencyKey, payload)
    return { ok: true, json: async () => payload }
  }) as never
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  jest.restoreAllMocks()
})

describe('console checkout idempotency (AGL-1697)', () => {
  it('THE DEFECT: a retried upgrade opened a SECOND session for the same org', async () => {
    const post = loadRoute()
    const first = await upgrade(post)
    const second = await upgrade(post)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    // One session on the live account — the second completed session used to
    // subscribe the org twice on the same customer.
    expect(calls).toHaveLength(1)
    expect(await second.json()).toEqual(await first.json())
  })

  it('THE DEFECT: two CONCURRENT submits of one attempt both reached Stripe', async () => {
    const post = loadRoute()
    const [a, b] = await Promise.all([upgrade(post), upgrade(post)])

    expect(calls).toHaveLength(1)
    // One wins; the loser is refused rather than let through, because letting
    // it through IS the duplicate subscription.
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([200, 409])
  })

  it('hands Stripe an idempotency key derived from the attempt', async () => {
    const post = loadRoute()
    await upgrade(post)
    expect(calls[0].idempotencyKey).toBeTruthy()
  })

  it('CONTROL — a DIFFERENT key opens a real second session', async () => {
    const post = loadRoute()
    await upgrade(post, { key: 'attempt-1' })
    await upgrade(post, { key: 'attempt-2' })
    expect(calls).toHaveLength(2)
  })

  it('CONTROL — no key at all still checks out, and dedupes nothing', async () => {
    // An older cached console bundle must not start failing upgrades.
    const post = loadRoute()
    await upgrade(post, { key: '' })
    await upgrade(post, { key: '' })
    expect(calls).toHaveLength(2)
    expect(claimDocs()).toHaveLength(0)
    expect(calls[0].idempotencyKey).toBeNull()
  })

  it('a Stripe refusal releases the key, and the retry reuses it', async () => {
    // Stripe answered, so nothing was created; the customer retries the same
    // button. The released key re-derives the SAME digest, so if a session
    // did get created Stripe replays it rather than opening a second one.
    stripeFault = { ok: false, body: { error: { message: 'declined' } } }
    const post = loadRoute()
    expect((await upgrade(post)).status).toBe(502)
    expect(claimDocs()).toHaveLength(0)

    expect((await upgrade(post)).status).toBe(200)
    expect(calls).toHaveLength(2)
    expect(calls[0].idempotencyKey).toBeTruthy()
    expect(calls[1].idempotencyKey).toBe(calls[0].idempotencyKey)
  })

  it('CONTROL — the subscription_exists guard refuses ABOVE the claim', async () => {
    // The 17b0628c3 status guard is the sequential half; it must refuse
    // before the claim so the 409 never burns the key — an org that churns
    // and returns can pay again with the same button.
    mockReadOrgBilling.mockResolvedValue({
      stripeCustomerId: 'cus_1',
      subscription: { status: 'active', priceId: 'price_pro_month' },
    })
    const post = loadRoute()
    const refused = await upgrade(post)
    expect(refused.status).toBe(409)
    expect((await refused.json()).code).toBe('subscription_exists')
    expect(calls).toHaveLength(0)
    expect(claimDocs()).toHaveLength(0)

    // The subscription lapses; the SAME key still works.
    mockReadOrgBilling.mockResolvedValue({
      stripeCustomerId: 'cus_1',
      subscription: { status: 'canceled', priceId: 'price_pro_month' },
    })
    expect((await upgrade(post)).status).toBe(200)
  })
})
