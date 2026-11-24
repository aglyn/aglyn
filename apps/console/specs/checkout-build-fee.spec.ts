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
 * A website build fee rides the hand-off checkout (AGL-4244): read from the
 * proposal or the bundle link's record, quoted on the same Stripe preview as
 * the plan, and charged once on the subscription's FIRST invoice through
 * `add_invoice_items`, priced against a product whose tax code is checked,
 * with automatic tax on. A paid fee, or one whose earlier first invoice
 * Stripe reports paid, is never charged again.
 *
 * Harness lifted from `checkout-site-care.spec.ts`. No live Stripe call
 * happens: `fetch` is mocked and the captured request is the assertion.
 */

const mockVerifyIdToken = jest.fn()

/** The workspace's documents: the org (with its proposal), its bundle links, its billing record. */
const mockDocs = new Map<string, Record<string, any>>()
const mockUpdates: Array<{ path: string; patch: Record<string, unknown> }> = []

function mockSnapshot(path: string) {
  return {
    id: path.split('/').pop(),
    exists: mockDocs.has(path),
    data: () => mockDocs.get(path),
    get: (field: string) => mockDocs.get(path)?.[field],
  }
}

function mockFirestore(): any {
  return {
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        get: async (ref: { path: string }) => mockSnapshot(ref.path),
        update: (ref: { path: string }, patch: Record<string, unknown>) =>
          mockUpdates.push({ path: ref.path, patch }),
        set: (ref: { path: string }, patch: Record<string, unknown>) =>
          mockUpdates.push({ path: ref.path, patch }),
      }),
    collection: (name: string) =>
      name === 'apiIdempotency'
        ? { doc: (id: string) => mockAttemptDocRef(id) }
        : {
            where: (field: string, _op: string, value: unknown) => ({
              limit: () => ({
                get: async () => ({
                  docs: [...mockDocs.keys()]
                    .filter((path) => path.startsWith(`${name}/`) && mockDocs.get(path)?.[field] === value)
                    .map((path) => ({ ...mockSnapshot(path), ref: { path } })),
                }),
              }),
            }),
            doc: (id = `auto-${mockDocs.size + mockUpdates.length}`) => ({
              path: `${name}/${id}`,
              collection: (sub: string) => ({
                doc: (subId: string) => ({
                  path: `${name}/${id}/${sub}/${subId}`,
                  get: async () => mockSnapshot(`${name}/${id}/${sub}/${subId}`),
                }),
              }),
              get: async () => mockSnapshot(`${name}/${id}`),
              update: async (patch: Record<string, unknown>) => {
                mockUpdates.push({ path: `${name}/${id}`, patch })
              },
            }),
          },
  }
}

const mockAttemptDocs = new Map<string, Record<string, unknown>>()

function mockAttemptDocRef(id: string) {
  return {
    create: async (data: Record<string, unknown>) => {
      if (mockAttemptDocs.has(id)) throw new Error('ALREADY_EXISTS')
      mockAttemptDocs.set(id, { ...data })
    },
    get: async () => ({
      get: (field: string) => mockAttemptDocs.get(id)?.[field],
    }),
    set: async (
      data: Record<string, unknown>,
      options?: { merge?: boolean },
    ) => {
      mockAttemptDocs.set(
        id,
        options?.merge ? { ...(mockAttemptDocs.get(id) ?? {}), ...data } : { ...data },
      )
    },
    delete: async () => {
      mockAttemptDocs.delete(id)
    },
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => mockFirestore(),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  featureLockdownRefusal: async () => null,
  memberHasOrgPermission: async () => true,
  readOrgBilling: async () => ({ stripeCustomerId: 'cus_test_1' }),
  resolveOrgMembership: async () => ({ orgId: 'org-1', member: { id: 'm-1' } }),
  isServerReleaseFlagOnForOrg: async () => false,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan model: `planSellsSiteCare(plan)` is the rule that keeps
  // Free from buying Site Care, and a stub would make that decision about
  // nothing.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  claimAttempt: jest.requireActual('@aglyn/aglyn/app-utils/api-idempotency')
    .claimAttempt,
  isOrgSubscriptionLive: jest.requireActual('@aglyn/aglyn/app-utils/org-billing-doc')
    .isOrgSubscriptionLive,
  isLiveSubscriptionStatus: jest.requireActual('@aglyn/aglyn/app-utils/org-billing-doc')
    .isLiveSubscriptionStatus,
  buildRoute: () => '/acme/manage/billing',
  Route: { MANAGE_BILLING: 'MANAGE_BILLING' },
  isReleaseFlagOn: () => false,
  pluginRequestFromWeb: async (
    request: Request,
    params?: Record<string, string | string[]>,
  ) => {
    const real = await jest
      .requireActual('@aglyn/aglyn/app-utils/api-adapter')
      .pluginRequestFromWeb(request, params)
    return {
      ...real,
      headers: {
        origin: 'https://app.aglyn.com',
        host: 'app.aglyn.com',
        ...real.headers,
      },
    }
  },
}))

const CLEAN_ENV = (() => {
  const clean = { ...process.env }
  for (const key of Object.keys(clean)) {
    if (key.startsWith('STRIPE_') || key.startsWith('NEXT_PUBLIC_STRIPE_')) delete clean[key]
  }
  return clean
})()

const ORIGINAL_ENV = process.env

const ENV = {
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_PRICE_STARTER: 'price_starter_monthly',
  STRIPE_PRICE_STARTER_YEARLY: 'price_starter_yearly',
  STRIPE_PRICE_SITE_CARE: 'price_site_care',
  STRIPE_PRICE_SITE_CARE_YEARLY: 'price_site_care_yearly',
}

let stripeCalls: Array<{ href: string; method: string; body: URLSearchParams }> = []
/** The Site Care product's tax code, which the build fee is priced against. */
let productTaxCode = 'txcd_10103001'

function loadCheckout(env: Record<string, string> = {}) {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, ...ENV, ...env } as NodeJS.ProcessEnv
  return require('../app/api/billing/checkout/route').POST as (request: Request) => Promise<Response>
}

let attemptSeq = 0
function post(handler: (request: Request) => Promise<Response>, body: Record<string, unknown>) {
  return handler(
    new Request('https://app.aglyn.com/api/billing/checkout', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
        'Idempotency-Key': `attempt-${++attemptSeq}`,
      },
      body: JSON.stringify({ plan: 'starter', interval: 'month', orgId: 'org-1', ...body }),
    }),
  )
}

const subscribeBody = () =>
  stripeCalls.find((call) => call.method === 'POST' && /\/v1\/subscriptions$/.test(call.href))?.body ?? null
const previewQuery = () => {
  const call = stripeCalls.find((entry) => entry.href.includes('/invoices/upcoming'))
  return call ? new URL(call.href).searchParams : null
}

const PROPOSAL = {
  plan: 'starter',
  proposedBy: 'staff-1',
  proposedAt: 1,
  addons: { siteCare: 1 },
  buildFee: { amountCents: 35000, label: 'E-commerce website build' },
}

beforeEach(() => {
  stripeCalls = []
  productTaxCode = 'txcd_10103001'
  mockAttemptDocs.clear()
  mockDocs.clear()
  mockUpdates.length = 0
  mockVerifyIdToken.mockResolvedValue({ uid: 'u-1', email_verified: true })
  mockDocs.set('orgs/org-1', { slug: 'acme', upgradeProposal: { ...PROPOSAL } })
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    const href = String(url)
    const method = String(init?.method ?? 'GET')
    stripeCalls.push({ href, method, body: new URLSearchParams(String(init?.body ?? '')) })
    if (/\/customers\//.test(href)) {
      return {
        ok: true,
        json: async () => ({
          invoice_settings: { default_payment_method: 'pm_saved_1' },
          address: { country: 'US' },
          tax_ids: { data: [] },
        }),
      }
    }
    if (/\/prices\/price_site_care/.test(href)) {
      return {
        ok: true,
        json: async () => ({ id: 'price_site_care', product: { id: 'prod_site_care', tax_code: productTaxCode } }),
      }
    }
    if (/\/invoices\/in_earlier/.test(href)) {
      return { ok: true, json: async () => ({ id: 'in_earlier', status: 'paid' }) }
    }
    if (href.includes('/invoices/upcoming')) {
      return {
        ok: true,
        json: async () => ({
          subtotal: 40400,
          tax: 2660,
          total: 43060,
          currency: 'usd',
          automatic_tax: { status: 'complete' },
        }),
      }
    }
    return {
      ok: true,
      json: async () => ({
        id: 'sub_1',
        status: 'active',
        latest_invoice: {
          id: 'in_first',
          subtotal: 40400,
          tax: 2660,
          total: 43060,
          currency: 'usd',
          automatic_tax: { status: 'complete' },
          payment_intent: { status: 'succeeded' },
        },
      }),
    }
  }) as never
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  jest.restoreAllMocks()
})

describe('the build fee is quoted with the plan (AGL-4244)', () => {
  it('rides the preview as a one-time, tax-exclusive line, and the answer names it', async () => {
    const response = await post(loadCheckout(), { action: 'preview', addons: { siteCare: 1 } })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.buildFee).toEqual({ amountCents: 35000, label: 'E-commerce website build' })
    expect(payload.preview).toMatchObject({ subtotalCents: 40400, taxCents: 2660, totalCents: 43060 })
    const query = previewQuery()
    expect(query?.get('automatic_tax[enabled]')).toBe('true')
    expect(query?.get('invoice_items[0][price_data][product]')).toBe('prod_site_care')
    expect(query?.get('invoice_items[0][price_data][unit_amount]')).toBe('35000')
    expect(query?.get('invoice_items[0][price_data][tax_behavior]')).toBe('exclusive')
  })

  it('is named on the quote even before the owner has a card or an address', async () => {
    const handler = loadCheckout()
    const tenant = jest.requireMock('@aglyn/tenant-data-admin') as Record<string, unknown>
    const original = tenant['readOrgBilling']
    tenant['readOrgBilling'] = async () => ({})
    try {
      const payload = await (await post(handler, { action: 'preview' })).json()
      expect(payload).toMatchObject({
        needsBillingDetails: true,
        buildFee: { amountCents: 35000, label: 'E-commerce website build' },
      })
    } finally {
      tenant['readOrgBilling'] = original
    }
  })

  it('reads the link’s fee from its record, never from the request', async () => {
    mockDocs.set('bundleLinks/link-1', {
      workspaceId: 'org-1',
      buildFee: { amountCents: 10000, label: 'Marketing website build' },
    })
    const payload = await (
      await post(loadCheckout(), {
        action: 'preview',
        bundleLinkId: 'link-1',
        // A figure in the body is ignored: only the record prices the fee.
        buildFee: { amountCents: 1, label: 'free' },
      })
    ).json()
    expect(payload.buildFee).toEqual({ amountCents: 10000, label: 'Marketing website build' })
    expect(previewQuery()?.get('invoice_items[0][price_data][unit_amount]')).toBe('10000')
  })

  it('adds nothing when no proposal or link carries one', async () => {
    mockDocs.set('orgs/org-1', { slug: 'acme' })
    const payload = await (await post(loadCheckout(), { action: 'preview' })).json()
    expect(payload).not.toHaveProperty('buildFee')
    expect(previewQuery()?.get('invoice_items[0][price_data][product]')).toBeNull()
  })
})

describe('the build fee is charged once, on the first invoice (AGL-4244)', () => {
  it('goes on the subscription as add_invoice_items, with its source on the metadata', async () => {
    const response = await post(loadCheckout(), { addons: { siteCare: 1 } })
    expect(response.status).toBe(200)
    const body = subscribeBody()
    expect(body?.get('items[0][price]')).toBe('price_starter_monthly')
    expect(body?.get('add_invoice_items[0][price_data][product]')).toBe('prod_site_care')
    expect(body?.get('add_invoice_items[0][price_data][unit_amount]')).toBe('35000')
    expect(body?.get('add_invoice_items[0][price_data][currency]')).toBe('usd')
    expect(body?.get('add_invoice_items[0][price_data][tax_behavior]')).toBe('exclusive')
    expect(body?.get('add_invoice_items[0][quantity]')).toBe('1')
    expect(body?.get('automatic_tax[enabled]')).toBe('true')
    expect(body?.get('metadata[buildFeeCents]')).toBe('35000')
    expect(body?.get('metadata[buildFeeSource]')).toBe('proposal')
    // Never as a recurring item: it would bill every renewal.
    expect([...(body?.keys() ?? [])].filter((key) => key.startsWith('items[') && body?.get(key) === 'prod_site_care')).toEqual([])
    // The first invoice is stamped on the proposal's fee.
    expect(mockUpdates).toEqual([
      {
        path: 'orgs/org-1',
        patch: {
          'upgradeProposal.buildFee.invoiceId': 'in_first',
          'upgradeProposal.buildFee.subscriptionId': 'sub_1',
        },
      },
    ])
    expect((await response.json()).buildFee).toEqual({ amountCents: 35000, label: 'E-commerce website build' })
  })

  it('names a link as its source when the link carries the fee', async () => {
    mockDocs.set('bundleLinks/link-1', { workspaceId: 'org-1', buildFee: { amountCents: 10000, label: 'Website build' } })
    await post(loadCheckout(), { bundleLinkId: 'link-1' })
    expect(subscribeBody()?.get('metadata[buildFeeSource]')).toBe('bundle:link-1')
    expect(mockUpdates[0]).toMatchObject({ path: 'bundleLinks/link-1' })
  })

  it('is not charged again once paid, nor when an earlier first invoice was paid', async () => {
    mockDocs.set('orgs/org-1', {
      slug: 'acme',
      upgradeProposal: { ...PROPOSAL, buildFee: { ...PROPOSAL.buildFee, paidInvoiceId: 'in_old', paidAt: 1 } },
    })
    await post(loadCheckout(), {})
    expect(subscribeBody()?.get('add_invoice_items[0][price_data][unit_amount]')).toBeNull()
    expect(subscribeBody()?.get('metadata[buildFeeSource]')).toBeNull()

    stripeCalls = []
    mockDocs.set('orgs/org-1', {
      slug: 'acme',
      upgradeProposal: { ...PROPOSAL, buildFee: { ...PROPOSAL.buildFee, invoiceId: 'in_earlier' } },
    })
    await post(loadCheckout(), {})
    expect(stripeCalls.some((call) => call.href.includes('/invoices/in_earlier'))).toBe(true)
    expect(subscribeBody()?.get('add_invoice_items[0][price_data][unit_amount]')).toBeNull()
    // The missed payment is recorded on the way: the proposal's fee is paid.
    expect(mockUpdates).toContainEqual({
      path: 'orgs/org-1',
      patch: {
        'upgradeProposal.buildFee.paidInvoiceId': 'in_earlier',
        'upgradeProposal.buildFee.paidAt': expect.any(Number),
      },
    })
  })

  it('charges nothing when the product does not carry the Aglyn service tax code', async () => {
    productTaxCode = 'txcd_99999999'
    const response = await post(loadCheckout(), {})
    expect(response.status).toBe(502)
    expect((await response.json()).code).toBe('build_fee_unpriced')
    expect(subscribeBody()).toBeNull()
  })

  it('replays a retried request instead of making a second subscription', async () => {
    const handler = loadCheckout()
    const request = () =>
      handler(
        new Request('https://app.aglyn.com/api/billing/checkout', {
          method: 'POST',
          headers: { authorization: 'Bearer tok', 'content-type': 'application/json', 'Idempotency-Key': 'same-key' },
          body: JSON.stringify({ plan: 'starter', interval: 'month', orgId: 'org-1' }),
        }),
      )
    expect((await request()).status).toBe(200)
    expect((await request()).status).toBe(200)
    expect(stripeCalls.filter((call) => call.method === 'POST' && /\/v1\/subscriptions$/.test(call.href))).toHaveLength(1)
  })
})

export {}
