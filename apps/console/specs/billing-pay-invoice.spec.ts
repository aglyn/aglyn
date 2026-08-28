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
 * Paying an open invoice, for the orgs every other billing route turns away.
 *
 * Before this route there was no way to pay in the console at all — the Stripe
 * Billing Portal button was the entire recovery story. The cases here are the
 * ones that make a recovery path a recovery path rather than another surface
 * that only serves healthy customers:
 *
 *  - an `unpaid` org can load it;
 *  - an org whose subscription dunning already CANCELLED can still pay its
 *    last invoice;
 *  - the paid state comes from the webhook, never from this route's own 200;
 *  - an invoice belonging to another customer is refused.
 *
 * `fetch` is mocked; no live Stripe call happens.
 */

export {}

import { stripTypeScriptComments } from '@aglyn/aglyn/foundation/definitions/write-deny-coverage.util'

const mockVerifyIdToken = jest.fn()
const mockReadOrgBilling = jest.fn()
const mockPermission = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: () => ({ doc: () => ({ set: async () => undefined }) }),
      }),
    }),
    firestore: { FieldValue: { serverTimestamp: () => 'ts' } },
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  memberHasOrgPermission: (...args: unknown[]) => mockPermission(...args),
  readOrgBilling: (...args: unknown[]) => mockReadOrgBilling(...args),
  resolveOrgMembership: async () => ({ orgId: 'org-1', member: { id: 'm-1' } }),
  logOrgActivity: async () => undefined,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json(),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
      origin: 'https://app.aglyn.com',
      host: 'app.aglyn.com',
    },
  }),
}))

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

let calls: Array<{ url: string; method: string }> = []
let openInvoices: unknown[] = []
let invoiceRecord: Record<string, unknown> = {}
let payOutcome: { ok: boolean; payload: unknown } = { ok: true, payload: {} }

function load() {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, STRIPE_SECRET_KEY: 'sk_test_fake' } as NodeJS.ProcessEnv
  return require('../app/api/billing/pay-invoice/route').POST as (
    request: Request,
  ) => Promise<Response>
}

function post(handler: (r: Request) => Promise<Response>, body: Record<string, unknown>) {
  return handler(
    new Request('https://app.aglyn.com/api/billing/pay-invoice', {
      method: 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1', ...body }),
    }),
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  calls = []
  openInvoices = [
    {
      id: 'in_1',
      number: 'AG-001',
      status: 'open',
      amount_due: 2665,
      currency: 'usd',
      created: 1760000000,
    },
  ]
  invoiceRecord = { id: 'in_1', status: 'open', customer: 'cus_test_1' }
  payOutcome = { ok: true, payload: { status: 'paid' } }
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-1',
    email: 'owner@example.com',
    email_verified: true,
  })
  mockPermission.mockResolvedValue(true)
  mockReadOrgBilling.mockResolvedValue({ stripeCustomerId: 'cus_test_1' })
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    const href = String(url)
    const method = String(init?.method ?? 'GET')
    calls.push({ url: href, method })
    if (href.includes('/pay')) {
      return { ok: payOutcome.ok, status: payOutcome.ok ? 200 : 402, json: async () => payOutcome.payload }
    }
    if (/invoices\/[^/?]+$/.test(href)) {
      return { ok: true, status: 200, json: async () => invoiceRecord }
    }
    return { ok: true, status: 200, json: async () => ({ data: openInvoices }) }
  }) as never
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  jest.restoreAllMocks()
})

describe('the orgs this route exists for', () => {
  it('an UNPAID org can load what it owes', async () => {
    // The org in dunning is the org that needs this, and the org whose console
    // access is being restricted everywhere else.
    mockReadOrgBilling.mockResolvedValue({
      stripeCustomerId: 'cus_test_1',
      subscription: { status: 'unpaid' },
    })
    const response = await post(load(), { action: 'get' })
    expect(response.status).toBe(200)
    expect((await response.json()).invoices).toHaveLength(1)
  })

  it('an org CANCELLED by dunning can still pay its last invoice', async () => {
    // Dunning cancels subscriptions after enough failed retries. The invoice
    // is still owed. A subscription check here would make the lock permanent,
    // so there deliberately is not one.
    mockReadOrgBilling.mockResolvedValue({
      stripeCustomerId: 'cus_test_1',
      subscription: { status: 'canceled' },
    })
    const response = await post(load(), { action: 'pay', invoiceId: 'in_1' })
    expect(response.status).toBe(200)
    expect(calls.some((call) => call.url.includes('/pay'))).toBe(true)
  })

  it('is exempt from the billing lockdown, in writing', () => {
    // The `lockdown-423-coverage` sweep forces every route to be wired,
    // delegated or exempt. This one must be exempt or a locked org — the only
    // kind that needs it — is refused.
    const source = require('node:fs').readFileSync(
      require('node:path').join(
        __dirname,
        '..',
        'app',
        'api',
        'billing',
        'pay-invoice',
        'route.ts',
      ),
      'utf8',
    )
    expect(source).toMatch(/\/\/\s*lockdown-423:\s*exempt\s*—/)
  })
})

describe('who decides that it was paid', () => {
  it('reports the attempt, never the paid state', async () => {
    // The paid state comes from `invoice.payment_succeeded` on the webhook. A
    // route that answered `{ paid: true }` because its own Stripe call
    // returned 200 is the browser deciding a thing only the webhook knows.
    const payload = await (await post(load(), { action: 'pay', invoiceId: 'in_1' })).json()
    expect(payload.submitted).toBe(true)
    expect(payload.paid).toBeUndefined()
  })

  it('hands back the client secret when an issuer wants authentication', async () => {
    // An invoice that silently fails to a 3DS prompt nobody sees is the same
    // defect as a first purchase that does.
    payOutcome = {
      ok: false,
      payload: {
        error: {
          code: 'invoice_payment_intent_requires_action',
          payment_intent: { client_secret: 'pi_secret_1' },
        },
      },
    }
    const payload = await (await post(load(), { action: 'pay', invoiceId: 'in_1' })).json()
    expect(payload.requiresAction).toBe(true)
    expect(payload.paymentClientSecret).toBe('pi_secret_1')
    expect(payload.submitted).toBeUndefined()
  })

  it('surfaces a decline as a decline', async () => {
    payOutcome = {
      ok: false,
      payload: { error: { code: 'card_declined', message: 'Your card was declined.' } },
    }
    const response = await post(load(), { action: 'pay', invoiceId: 'in_1' })
    expect(response.status).toBe(402)
    const payload = await response.json()
    expect(payload.declined).toBe(true)
    expect(payload.error).toBe('Your card was declined.')
  })
})

describe('the invoice id comes from the browser', () => {
  it('refuses an invoice belonging to another customer', async () => {
    // Otherwise one workspace could pay — or probe — another's bill.
    invoiceRecord = { id: 'in_1', status: 'open', customer: 'cus_someone_else' }
    const response = await post(load(), { action: 'pay', invoiceId: 'in_1' })
    expect(response.status).toBe(404)
    expect(calls.some((call) => call.url.includes('/pay'))).toBe(false)
  })

  it('says so when it is already settled, rather than charging again', async () => {
    invoiceRecord = { id: 'in_1', status: 'paid', customer: 'cus_test_1' }
    const payload = await (await post(load(), { action: 'pay', invoiceId: 'in_1' })).json()
    expect(payload.alreadyPaid).toBe(true)
    expect(calls.some((call) => call.url.includes('/pay'))).toBe(false)
  })

  it('CONTROL — the happy path really does call Stripe’s pay endpoint', async () => {
    // Two cases above assert that Stripe was NOT called; both are worthless if
    // the wiring made the call impossible.
    await post(load(), { action: 'pay', invoiceId: 'in_1' })
    expect(calls.some((call) => call.url.includes('/pay') && call.method === 'POST')).toBe(true)
  })
})

describe('tax is not recomputed on an invoice', () => {
  it('never prices anything — it reads amount_due and pays', async () => {
    // An invoice is paid at the amount it was issued for. Its tax was fixed at
    // issue; re-running `automatic_tax` against a since-changed address would
    // charge a different number from the document the customer is reading.
    // Comments STRIPPED: the route's docblock explains at length why tax is
    // not recomputed, and the explanation naming `automatic_tax` must not
    // trip the rule it is explaining.
    const source = stripTypeScriptComments(
      require('node:fs').readFileSync(
        require('node:path').join(
          __dirname,
          '..',
          'app',
          'api',
          'billing',
          'pay-invoice',
          'route.ts',
        ),
        'utf8',
      ),
    )
    // CONTROL: the stripper did not reduce the file to whitespace.
    expect(source).toContain('amount_due')
    expect(source).not.toContain('automatic_tax')
    expect(source).not.toContain('invoices/upcoming')
  })
})

describe('a deployment with no Stripe', () => {
  it('answers 501 before touching anything', async () => {
    jest.resetModules()
    process.env = { ...CLEAN_ENV } as NodeJS.ProcessEnv
    const handler = require('../app/api/billing/pay-invoice/route').POST
    const response = await post(handler, { action: 'get' })
    expect(response.status).toBe(501)
    expect(calls).toHaveLength(0)
  })

  it('CONTROL — the same request works with a test key', async () => {
    expect((await post(load(), { action: 'get' })).status).toBe(200)
  })
})

describe('where the dunning email sends people', () => {
  it('points at the org-agnostic billing entry, which exists', () => {
    // The link arrives by email, so the recipient is routinely signed out or
    // in the wrong workspace. A slug-scoped URL would 404 or land them
    // somewhere that is not theirs.
    const {
      DUNNING_EMAIL_RETURN_PATH,
      dunningEmailReturnUrl,
      // eslint-disable-next-line @typescript-eslint/no-var-requires
    } = require('../utils/stripe-dunning-schedule')
    expect(DUNNING_EMAIL_RETURN_PATH).toBe('/billing')
    expect(dunningEmailReturnUrl('https://app.aglyn.com')).toBe(
      'https://app.aglyn.com/billing',
    )
    // CONTROL: the route it names is a real page in this app, so the constant
    // cannot drift into naming somewhere that 404s.
    expect(
      require('node:fs').existsSync(
        require('node:path').join(
          __dirname,
          '..',
          'app',
          '(app)',
          'billing',
          'page.tsx',
        ),
      ),
    ).toBe(true)
  })
})
