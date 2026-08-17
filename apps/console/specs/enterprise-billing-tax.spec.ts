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
 * Enterprise provisioning charges sales tax (AGL-1811).
 *
 * The self-serve surface has computed tax since AGL-1133/1537 — checkout,
 * plan switches and add-on purchases all send `automatic_tax[enabled]`. The
 * enterprise route was the one path still creating untaxed charges, in both
 * of its modes:
 *
 * - `invoice` mode POSTs `/v1/subscriptions` directly, so nothing downstream
 *   can add tax — the flag has to ride the create.
 * - `checkout` mode opens a session with a REUSED customer and collected no
 *   address, so even with the flag the session would report
 *   `requires_location_inputs` and silently charge no tax. The parameter set
 *   is load-bearing as a SET (same lesson as `checkout-tax-collection.spec`).
 *
 * The failure mode is decided here rather than discovered in production:
 * this route MINTS enterprise customers with a name and metadata only — no
 * address — and Stripe refuses to create an automatic-tax subscription for a
 * customer whose tax location cannot be resolved
 * (`customer_tax_location_invalid`). That refusal must come back as an
 * actionable instruction to staff, and must release the attempt key so the
 * same button works after the address is set.
 *
 * No live Stripe call happens here: `fetch` is mocked for the whole file —
 * localhost carries the LIVE key — and the captured request bodies are the
 * assertion surface.
 */

// A module, not a script — without this the const declarations below collide
// with the other console billing route specs' identical globals under `tsc`.
export {}

const mockVerifyIdToken = jest.fn()
const mockReadOrgBilling = jest.fn()
const mockWriteOrgBilling = jest.fn()

/** Every document the handler wrote, keyed by `collection/id`. */
let docs = new Map<string, Record<string, unknown>>()

/** In-memory Firestore, enough for the real `claimAttempt` plus the org read. */
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
  claimAttempt: jest.requireActual('@aglyn/aglyn/app-utils/api-idempotency')
    .claimAttempt,
  isOrgSubscriptionLive: jest.requireActual('@aglyn/aglyn/app-utils/org-billing-doc')
    .isOrgSubscriptionLive,
  PLAN_PRICING: {
    free: { monthly: 0 },
    starter: { monthly: 19 },
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
}
let calls: StripeCall[] = []

/** Per-endpoint overrides: `{ ok: false, body }` makes that endpoint refuse. */
let stripeFaults: Record<string, { ok: boolean; body?: unknown }> = {}

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
  options: { key?: string; mode?: 'invoice' | 'checkout' } = {},
) {
  const { key = 'attempt-1', mode = 'invoice' } = options
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
        amountMonthlyUsd: 4000,
        interval: 'month',
        plan: 'starter',
        mode,
      }),
    }),
  )
}

beforeEach(() => {
  calls = []
  stripeFaults = {}
  docs = new Map()
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
  mockReadOrgBilling.mockResolvedValue({ stripeCustomerId: 'cus_ent_1' })
  mockWriteOrgBilling.mockResolvedValue(undefined)
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    const href = String(url)
    for (const [fragment, fault] of Object.entries(stripeFaults)) {
      if (!href.includes(fragment)) continue
      calls.push({ url: href, params: new URLSearchParams(String(init?.body ?? '')) })
      return { ok: fault.ok, status: fault.ok ? 200 : 400, json: async () => fault.body }
    }
    calls.push({ url: href, params: new URLSearchParams(String(init?.body ?? '')) })
    if (href.includes('products/search')) return { ok: true, json: async () => ({ data: [] }) }
    if (href.includes('/products')) return { ok: true, json: async () => ({ id: 'prod_1' }) }
    if (href.includes('/prices')) return { ok: true, json: async () => ({ id: 'price_1' }) }
    if (href.includes('checkout/sessions')) {
      return {
        ok: true,
        json: async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/c/session-1' }),
      }
    }
    if (href.includes('/subscriptions')) {
      return {
        ok: true,
        json: async () => ({
          id: 'sub_1',
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

describe('enterprise invoice mode computes tax (AGL-1811)', () => {
  it('THE DEFECT: the direct subscription create carried no automatic_tax at all', async () => {
    const post = loadRoute()
    expect((await provision(post)).status).toBe(200)

    const create = callsTo('/subscriptions')[0]
    expect(create).toBeTruthy()
    expect(create.params.get('automatic_tax[enabled]')).toBe('true')
  })

  it('PIN — tax rides ALONGSIDE the net-30 shape, not instead of it', async () => {
    const post = loadRoute()
    await provision(post)

    const create = callsTo('/subscriptions')[0]
    expect(create.params.get('collection_method')).toBe('send_invoice')
    expect(create.params.get('days_until_due')).toBe('30')
    expect(create.params.get('metadata[custom]')).toBe('true')
    expect(create.params.get('metadata[orgId]')).toBe('org-1')
  })

  it('an address-less customer gets an ACTIONABLE refusal, and the key is released', async () => {
    // The enterprise flow mints customers with a name and metadata only, so
    // this is the guaranteed first-run outcome for a fresh org — it must not
    // read as a generic Stripe failure.
    stripeFaults = {
      '/subscriptions': {
        ok: false,
        body: {
          error: {
            code: 'customer_tax_location_invalid',
            message: 'The customer must have a valid location to compute tax.',
          },
        },
      },
    }
    const post = loadRoute()
    const response = await provision(post)
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('customer_address_required')
    // The message must tell staff what to actually do, not restate the code.
    expect(String(body.error)).toMatch(/billing address/i)
    // Stripe answered — nothing was created — so the key is handed back and
    // the SAME button works once the address is set.
    expect(claimDocs()).toHaveLength(0)

    stripeFaults = {}
    expect((await provision(post)).status).toBe(200)
  })

  it('CONTROL — an unrelated Stripe refusal still reads as a 502, not an address problem', async () => {
    stripeFaults = {
      '/subscriptions': {
        ok: false,
        body: { error: { code: 'card_declined', message: 'Nope' } },
      },
    }
    const post = loadRoute()
    const response = await provision(post)
    expect(response.status).toBe(502)
    expect((await response.json()).code).toBeUndefined()
  })
})

describe('enterprise checkout mode computes tax (AGL-1811)', () => {
  it('THE DEFECT: the session enabled no automatic_tax', async () => {
    const post = loadRoute()
    expect((await provision(post, { mode: 'checkout' })).status).toBe(200)

    const session = callsTo('checkout/sessions')[0]
    expect(session).toBeTruthy()
    expect(session.params.get('automatic_tax[enabled]')).toBe('true')
  })

  it('collects the address the tax computation depends on — the set, not the flag', async () => {
    // `automatic_tax` on a session with no address reports
    // `requires_location_inputs` and silently charges nothing. And this
    // session always carries a REUSED customer, whose tax location Stripe
    // resolves from the CUSTOMER record — `customer_update[address]=auto`
    // saves the collected address back onto it, which is also what makes the
    // send_invoice renewals computable afterwards.
    const post = loadRoute()
    await provision(post, { mode: 'checkout' })

    const session = callsTo('checkout/sessions')[0]
    expect(session.params.get('billing_address_collection')).toBe('required')
    expect(session.params.get('customer')).toBe('cus_ent_1')
    expect(session.params.get('customer_update[address]')).toBe('auto')
  })

  it('PIN — the session keeps its subscription shape and metadata', async () => {
    const post = loadRoute()
    await provision(post, { mode: 'checkout' })

    const session = callsTo('checkout/sessions')[0]
    expect(session.params.get('mode')).toBe('subscription')
    expect(session.params.get('line_items[0][price]')).toBe('price_1')
    expect(session.params.get('subscription_data[metadata][custom]')).toBe('true')
    expect(session.params.get('subscription_data[metadata][orgId]')).toBe('org-1')
  })
})
