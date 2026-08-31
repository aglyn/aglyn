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
 * Tax IDs on the native billing page.
 *
 * Two things are load-bearing and neither is obvious from reading the handler:
 *
 *  1. The `(type, value)` pair reaches Stripe UNEXAMINED. There is no
 *     per-country regex of ours in the path, because Stripe validates per type
 *     against rules that track the law, and a second validator would eventually
 *     refuse an identifier Stripe would have accepted — a customer unable to
 *     put their own VAT number on their own invoice.
 *  2. When Stripe refuses, the customer reads STRIPE'S OWN SENTENCE. It names
 *     the format expected for the type they chose. A generic "that did not
 *     save" is unactionable, and a sentence of ours would go stale.
 *
 * And one thing that is load-bearing and invisible: the rejected VALUE is a tax
 * registration number, so it goes back to the customer who typed it and NOT
 * into a log line that ships to a drain.
 *
 * No live Stripe call happens here — `fetch` is mocked and the captured request
 * is the assertion surface. No real tax identifier appears anywhere in this
 * file; the values below are shaped like Stripe's documentation examples and
 * belong to nobody.
 */

// A module, not a script — without this the const declarations below collide
// with the other billing route specs' identical globals under `tsc`.
export {}

const mockVerifyIdToken = jest.fn()
const mockReadOrgBilling = jest.fn()
const mockLogOrgActivity = jest.fn()
const mockOrgSet = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: () => ({ doc: () => ({ set: (...a: unknown[]) => mockOrgSet(...a) }) }),
      }),
    }),
    firestore: { FieldValue: { serverTimestamp: () => 'ts' } },
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  memberHasOrgPermission: async () => true,
  readOrgBilling: (...args: unknown[]) => mockReadOrgBilling(...args),
  resolveOrgMembership: async () => ({ orgId: 'org-1', member: { id: 'm-1' } }),
  readOrgBillingCustomerModes: async () => ({ live: false, test: false }),
  logOrgActivity: (...args: unknown[]) => mockLogOrgActivity(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL normalizer. A hand-written double would let a spec pass while the
  // route's actual country handling changed underneath it.
  normalizeAddress: jest.requireActual(
    '@aglyn/aglyn/foundation/definitions/contact.types',
  ).normalizeAddress,
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
  method: string
  body: URLSearchParams | null
}

let calls: StripeCall[] = []
/** Keyed by the Stripe path fragment the route will request. */
let responders: Array<{
  match: (url: string, method: string) => boolean
  reply: () => { ok: boolean; status: number; json: unknown }
}> = []

function loadRoute() {
  jest.resetModules()
  process.env = {
    ...CLEAN_ENV,
    STRIPE_SECRET_KEY: 'sk_test_fake',
  } as NodeJS.ProcessEnv
  return require('../app/api/billing/profile/route').POST as (
    request: Request,
  ) => Promise<Response>
}

function post(
  handler: (request: Request) => Promise<Response>,
  body: Record<string, unknown>,
) {
  return handler(
    new Request('https://app.aglyn.com/api/billing/profile', {
      method: 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1', ...body }),
    }),
  )
}

/** The healthy answers every read the route makes after a successful write. */
function defaultResponders() {
  return [
    {
      match: (url: string) => /\/customers\/[^/]+$/.test(url),
      reply: () => ({
        ok: true,
        status: 200,
        json: {
          email: 'finance@example.com',
          name: 'Example Co',
          address: null,
          invoice_settings: {},
        },
      }),
    },
    {
      match: (url: string) => url.includes('/tax_ids'),
      reply: () => ({
        ok: true,
        status: 200,
        json: {
          data: [
            {
              id: 'txi_1',
              type: 'us_ein',
              value: '00-0000000',
              verification: { status: 'verified' },
            },
          ],
        },
      }),
    },
    {
      match: (url: string) => url.includes('/payment_methods'),
      reply: () => ({ ok: true, status: 200, json: { data: [] } }),
    },
    {
      match: (url: string) => url.includes('subscriptions?'),
      reply: () => ({ ok: true, status: 200, json: { data: [] } }),
    },
  ]
}

beforeEach(() => {
  // `jest.fn()`s declared at module scope keep their call history across
  // tests, and `restoreAllMocks` does not touch them — so the "never reached
  // auth" assertions below would read every earlier test's calls.
  jest.clearAllMocks()
  calls = []
  responders = defaultResponders()
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-1',
    email: 'owner@example.com',
    email_verified: true,
  })
  mockReadOrgBilling.mockResolvedValue({ stripeCustomerId: 'cus_test_1' })
  mockOrgSet.mockResolvedValue(undefined)
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    const href = String(url)
    const method = String(init?.method ?? 'GET')
    calls.push({
      url: href,
      method,
      body: init?.body ? new URLSearchParams(String(init.body)) : null,
    })
    const responder = responders.find((entry) => entry.match(href, method))
    const outcome = responder
      ? responder.reply()
      : { ok: true, status: 200, json: {} }
    return {
      ok: outcome.ok,
      status: outcome.status,
      json: async () => outcome.json,
    }
  }) as never
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  jest.restoreAllMocks()
})

describe('saving a tax ID', () => {
  it('posts the type and value Stripe was given, unexamined', async () => {
    const handler = loadRoute()
    const response = await post(handler, {
      action: 'add-tax-id',
      taxIdType: 'us_ein',
      taxIdValue: '00-0000000',
    })
    expect(response.status).toBe(200)
    const write = calls.find(
      (call) => call.method === 'POST' && call.url.includes('/tax_ids'),
    )
    expect(write?.body?.get('type')).toBe('us_ein')
    expect(write?.body?.get('value')).toBe('00-0000000')
  })

  it('accepts a type this build has never heard of', async () => {
    // The generated list is a PICKER's source, not a gate. If it ever trails
    // Stripe, a customer must still be able to save a type Stripe accepts —
    // otherwise our dependency bump cadence decides which countries can bill.
    const handler = loadRoute()
    const response = await post(handler, {
      action: 'add-tax-id',
      taxIdType: 'zz_future',
      taxIdValue: 'ABC123',
    })
    expect(response.status).toBe(200)
    const write = calls.find(
      (call) => call.method === 'POST' && call.url.includes('/tax_ids'),
    )
    expect(write?.body?.get('type')).toBe('zz_future')
  })

  it('shows Stripe’s own rejection, word for word', async () => {
    const stripeMessage =
      "The tax ID number is invalid for the type 'au_abn'. Australian ABNs " +
      'are 11 digits.'
    responders.unshift({
      match: (url: string, method: string) =>
        method === 'POST' && url.includes('/tax_ids'),
      reply: () => ({
        ok: false,
        status: 400,
        json: {
          error: {
            type: 'invalid_request_error',
            code: 'tax_id_invalid',
            param: 'value',
            message: stripeMessage,
          },
        },
      }),
    })
    const handler = loadRoute()
    const response = await post(handler, {
      action: 'add-tax-id',
      taxIdType: 'au_abn',
      taxIdValue: '123',
    })
    expect(response.status).toBe(400)
    const payload = await response.json()
    // Verbatim. Stripe names the format expected for the chosen type, which is
    // the only sentence that stays true as the rules change.
    expect(payload.error).toBe(stripeMessage)
    expect(payload.stripeCode).toBe('tax_id_invalid')
  })

  it('keeps the rejected value out of the logs', async () => {
    // Stripe's refusal quotes the number back. Showing a customer their own
    // typo is fine; copying it into a log that ships to a drain and sits in a
    // retention window is not.
    const secretish = 'AB-9999999'
    responders.unshift({
      match: (url: string, method: string) =>
        method === 'POST' && url.includes('/tax_ids'),
      reply: () => ({
        ok: false,
        status: 400,
        json: {
          error: {
            code: 'tax_id_invalid',
            param: 'value',
            message: `${secretish} is not a valid au_abn`,
          },
        },
      }),
    })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const handler = loadRoute()
    await post(handler, {
      action: 'add-tax-id',
      taxIdType: 'au_abn',
      taxIdValue: secretish,
    })
    const logged = JSON.stringify(errorSpy.mock.calls)
    expect(logged).not.toContain(secretish)
    // CONTROL for this assertion: the route DID log the failure, so the
    // absence above is redaction and not silence. A handler that logged
    // nothing at all would pass a bare `not.toContain`.
    expect(errorSpy).toHaveBeenCalled()
    expect(logged).toContain('tax_id_invalid')
  })

  it('records the TYPE in the activity log, never the number', async () => {
    const handler = loadRoute()
    await post(handler, {
      action: 'add-tax-id',
      taxIdType: 'us_ein',
      taxIdValue: '00-0000000',
    })
    const entry = String(mockLogOrgActivity.mock.calls[0]?.[2] ?? '')
    expect(entry).toContain('United States EIN')
    expect(entry).not.toContain('00-0000000')
  })

  it('refuses an incomplete pair without calling Stripe', async () => {
    const handler = loadRoute()
    const response = await post(handler, {
      action: 'add-tax-id',
      taxIdType: 'us_ein',
      taxIdValue: '   ',
    })
    expect(response.status).toBe(400)
    expect(calls.some((call) => call.url.includes('/tax_ids'))).toBe(false)
  })

  it('CONTROL — the happy path really does reach Stripe', async () => {
    // Every "did not call Stripe" assertion above is worthless if the mock
    // were mis-wired such that nothing ever calls Stripe. This is the case
    // that proves the wire works.
    const handler = loadRoute()
    await post(handler, {
      action: 'add-tax-id',
      taxIdType: 'gb_vat',
      taxIdValue: 'GB000000000',
    })
    expect(
      calls.some(
        (call) => call.method === 'POST' && call.url.includes('/tax_ids'),
      ),
    ).toBe(true)
  })
})

describe('reading tax IDs back', () => {
  it('surfaces them with their type and verification state', async () => {
    const handler = loadRoute()
    const response = await post(handler, { action: 'get' })
    const payload = await response.json()
    expect(payload.taxIds).toHaveLength(1)
    expect(payload.taxIds[0].type).toBe('us_ein')
    expect(payload.taxIds[0].verification).toBe('verified')
  })

  it('says nothing about tax IDs for an org with no Stripe customer', async () => {
    mockReadOrgBilling.mockResolvedValue({})
    const handler = loadRoute()
    const response = await post(handler, { action: 'get' })
    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload.customer).toBeNull()
    expect(payload.taxIds).toEqual([])
    // Never billed is not the same as billed-in-the-other-Stripe-mode
    // (AGL-2486), and the card renders them differently.
    expect(payload.otherModeOnly).toBe(false)
  })
})

describe('a deployment with no Stripe', () => {
  it('answers 501 before touching anything', async () => {
    jest.resetModules()
    process.env = { ...CLEAN_ENV } as NodeJS.ProcessEnv
    const handler = require('../app/api/billing/profile/route').POST
    const response = await post(handler, {
      action: 'add-tax-id',
      taxIdType: 'us_ein',
      taxIdValue: '00-0000000',
    })
    expect(response.status).toBe(501)
    expect((await response.json()).error).toBe('Stripe is not configured')
    expect(calls).toHaveLength(0)
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
  })

  it('treats a placeholder key as unconfigured, not as configured-and-broken', async () => {
    // A `.env` left holding the template's own value is truthy. The prefix
    // test is what makes a half-filled file read as "no billing here" rather
    // than as a Stripe outage nobody can explain.
    jest.resetModules()
    process.env = {
      ...CLEAN_ENV,
      STRIPE_SECRET_KEY: 'your-key-here',
    } as NodeJS.ProcessEnv
    const handler = require('../app/api/billing/profile/route').POST
    const response = await post(handler, { action: 'get' })
    expect(response.status).toBe(501)
  })

  it('CONTROL — the same request succeeds once a real test key is present', async () => {
    const handler = loadRoute()
    const response = await post(handler, { action: 'get' })
    expect(response.status).toBe(200)
  })
})
