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
 * AN EMPTY INVOICE LIST HAS TWO MEANINGS (AGL-2486, follow-up).
 *
 * Measured on `test-org` (`hz_KgetqSq`), which bought Starter and cancelled:
 * its live customer `cus_UuQjDdd1oxPMNH` and its invoices are all still there.
 * On localhost, where `STRIPE_SECRET_KEY` is `sk_test_…`, the mode-scoped read
 * correctly declines to hand a live id to a test key — and both billing cards
 * then printed **"No invoices yet."** over an intact history.
 *
 * That is the repo's swallowed-query-as-measured-zero shape: the limitation
 * ("this deployment cannot look them up") was rendered as an observation ("you
 * were never billed"), and nothing on screen looked wrong.
 *
 * The fallback is NOT the fix — restoring it re-opens the 502 the mode split
 * exists to prevent. The message is. So these routes now carry `otherModeOnly`
 * plus which mode this deployment spends in, and this file pins all three
 * states apart:
 *
 *   a. live deployment, live customer          → invoices, no notice
 *   b. TEST deployment, live-only customer     → `otherModeOnly: true`
 *   c. no customer in either mode              → `otherModeOnly: false`
 *
 * `deploymentLivemode` is the REAL implementation throughout, driven by
 * `STRIPE_SECRET_KEY` — the `sk_live_` inference is the thing being relied on,
 * so stubbing it would leave the mode decision untested.
 *
 * The storage layer is a fixture rather than a mock RETURN: one stored document
 * per case feeds both `readOrgBilling` and `readOrgBillingCustomerModes`
 * through the same projection rules the library applies, so a case cannot
 * assert a combination the real store could never produce. The library
 * implementation itself is pinned against a Firestore double in
 * `libs/tenant/data/admin/src/lib/server/org-billing-stripe-mode.spec.ts`.
 */

// A module, not a script — without this the const declarations below collide
// with the other console billing route specs' identical globals under `tsc`.
export {}

const LIVE_ID = 'cus_UuQjDdd1oxPMNH'
const TEST_ID = 'cus_TestModeTwin01'

/** The STORED billing document for `org-1`, per case — both physical slots. */
let mockStored: { stripeCustomerId?: string | null; stripeCustomerIdTest?: string | null }

/**
 * The decoded token the routes see. `mock`-prefixed because it is read inside
 * a `jest.mock` factory, which hoists above this declaration — and mutable
 * because the staff route needs the `staff` claim the member route must not
 * have. Re-read per call, so `jest.resetModules()` between cases cannot pin an
 * old value.
 */
let mockDecoded: Record<string, unknown>

/** The live half of `deploymentLivemode`, read by the fakes below. */
const mockLivemode = () =>
  String(process.env['STRIPE_SECRET_KEY'] ?? '').startsWith('sk_live_')

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => mockDecoded }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({ get: async () => ({ exists: true, data: () => ({}) }) }),
        }),
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  memberHasOrgPermission: async () => true,
  resolveOrgMembership: async (_uid: string, orgId: string | null) => ({
    orgId: orgId ?? 'org-1',
    member: { role: 'owner' },
  }),
  // The library's projection rule, applied to the fixture: this mode's slot,
  // and NO fallback to the other one. The absent fallback is the whole
  // AGL-2486 fix; encoding it here is what makes case (b) reachable at all.
  readOrgBilling: async () => ({
    stripeCustomerId:
      (mockLivemode() ? mockStored.stripeCustomerId : mockStored.stripeCustomerIdTest) ??
      null,
  }),
  // The census: booleans off the same fixture, never ids.
  readOrgBillingCustomerModes: async () => ({
    live: typeof mockStored.stripeCustomerId === 'string' && !!mockStored.stripeCustomerId,
    test:
      typeof mockStored.stripeCustomerIdTest === 'string' &&
      !!mockStored.stripeCustomerIdTest,
  }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      headers,
    }
  },
}))

/** Env without a trace of the developer's own Stripe config (`nx test` leaks the root .env). */
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

/** Every URL that left the handler for api.stripe.com. */
let stripeCalls: string[] = []

/** One paid invoice, as Stripe's list endpoint returns it. */
const PAID_INVOICE = {
  id: 'in_1',
  number: 'AGL-0001',
  status: 'paid',
  amount_due: 1900,
  total: 1900,
  currency: 'usd',
  created: 1_750_000_000,
  hosted_invoice_url: 'https://invoice.stripe.com/i/1',
  invoice_pdf: 'https://invoice.stripe.com/i/1.pdf',
}

function loadRoute(mode: 'live' | 'test') {
  jest.resetModules()
  process.env = {
    ...CLEAN_ENV,
    STRIPE_SECRET_KEY: mode === 'live' ? 'sk_live_fake' : 'sk_test_fake',
  } as NodeJS.ProcessEnv
  return require('../app/api/billing/invoices/route').GET as (
    request: Request,
  ) => Promise<Response>
}

function list(get: (request: Request) => Promise<Response>) {
  return get(
    new Request('https://app.aglyn.com/api/billing/invoices?orgId=org-1', {
      method: 'GET',
      headers: { authorization: 'Bearer tok' },
    }),
  )
}

beforeEach(() => {
  mockStored = { stripeCustomerId: LIVE_ID }
  mockDecoded = { uid: 'u1', email_verified: true, staff: false }
  stripeCalls = []
  global.fetch = jest.fn(async (input: any) => {
    stripeCalls.push(String(input))
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [PAID_INVOICE], has_more: false }),
    }
  }) as any
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  jest.restoreAllMocks()
})

describe('a. the live deployment reading its own customer is untouched', () => {
  it('lists the invoices and claims nothing about modes', async () => {
    const response = await list(loadRoute('live'))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.invoices).toHaveLength(1)
    expect(body.invoices[0].id).toBe('in_1')
    // The notice fields are attached ONLY to the missing-customer return. A
    // successful listing that also shipped `otherModeOnly` would be a second
    // answer to a question the invoice list already settled.
    expect(body.otherModeOnly).toBeUndefined()
    expect(body.deploymentMode).toBeUndefined()
    expect(stripeCalls.some((url) => url.includes(LIVE_ID))).toBe(true)
  })
})

describe('b. a TEST deployment over a live-only org says so', () => {
  it('reports the other mode instead of an unqualified empty list', async () => {
    const response = await list(loadRoute('test'))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.invoices).toEqual([])
    expect(body.hasMore).toBe(false)
    expect(body.otherModeOnly).toBe(true)
    expect(body.deploymentMode).toBe('test')
  })

  it('never hands the live customer id to a test-mode browser', async () => {
    // The census returns booleans for exactly this reason. A response that
    // carried `cus_…` from live Stripe would publish it to every browser on a
    // test deployment, and no caller here has any use for it.
    const body = await (await list(loadRoute('test'))).json()
    expect(JSON.stringify(body)).not.toContain(LIVE_ID)
  })

  it('does not call Stripe at all — there is nothing it could ask for', async () => {
    await list(loadRoute('test'))
    expect(stripeCalls).toEqual([])
  })

  it('holds in the MIRROR direction too: live deployment, test-only org', async () => {
    // Reachable in principle — an org first exercised in test mode, then
    // opened in production. A notice that only handled one direction would be
    // wrong in the other, and would read as "never billed" again.
    mockStored = { stripeCustomerIdTest: TEST_ID }
    const body = await (await list(loadRoute('live'))).json()
    expect(body.otherModeOnly).toBe(true)
    expect(body.deploymentMode).toBe('live')
  })
})

describe('c. a genuinely unbilled org is still genuinely unbilled', () => {
  it('reports no other mode, so the card keeps saying "No invoices yet."', async () => {
    mockStored = {}
    const body = await (await list(loadRoute('test'))).json()
    expect(body.invoices).toEqual([])
    expect(body.otherModeOnly).toBe(false)
    // The mode is still reported: it is a fact about the deployment, not about
    // the org, and the UI keys the message on `otherModeOnly` alone.
    expect(body.deploymentMode).toBe('test')
  })

  it('is the same answer on a live deployment', async () => {
    mockStored = {}
    const body = await (await list(loadRoute('live'))).json()
    expect(body.otherModeOnly).toBe(false)
    expect(body.deploymentMode).toBe('live')
  })
})

describe('the staff console answers the same three ways', () => {
  function loadAdminRoute(mode: 'live' | 'test') {
    jest.resetModules()
    process.env = {
      ...CLEAN_ENV,
      STRIPE_SECRET_KEY: mode === 'live' ? 'sk_live_fake' : 'sk_test_fake',
    } as NodeJS.ProcessEnv
    return require('../app/api/admin/org-billing/route').GET as (
      request: Request,
    ) => Promise<Response>
  }

  function staffList(get: (request: Request) => Promise<Response>) {
    return get(
      new Request('https://app.aglyn.com/api/admin/org-billing?orgId=org-1', {
        method: 'GET',
        headers: { authorization: 'Bearer tok' },
      }),
    )
  }

  beforeEach(() => {
    // The staff route refuses anything without the `staff` claim, and the
    // outer default deliberately does not have it.
    mockDecoded = { uid: 'staff-1', email_verified: true, staff: true }
  })

  it('a live-only org on a TEST deployment is not "never subscribed"', async () => {
    const body = await (await staffList(loadAdminRoute('test'))).json()
    expect(body.otherModeOnly).toBe(true)
    expect(body.deploymentMode).toBe('test')
    // `hasCustomer` keeps its AGL-940 meaning — "this deployment has no
    // customer to query" — and is exactly why it cannot carry this news too.
    expect(body.hasCustomer).toBe(false)
    expect(JSON.stringify(body)).not.toContain(LIVE_ID)
  })

  it('an org with no customer anywhere still reads as never subscribed', async () => {
    mockStored = {}
    const body = await (await staffList(loadAdminRoute('test'))).json()
    expect(body.hasCustomer).toBe(false)
    expect(body.otherModeOnly).toBe(false)
  })
})
