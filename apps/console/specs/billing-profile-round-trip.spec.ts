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
 * The billing email and address ROUND-TRIP.
 *
 * "Round-trip" is the assertion that matters and it is two halves: what the
 * customer typed reaches Stripe in the shape Stripe expects, AND what comes
 * back out of Stripe is what the card re-renders. A save that writes correctly
 * but re-reads from a stale local copy looks identical in the browser until
 * someone reloads.
 *
 * Two behaviors here are not obvious and are the ones most likely to be
 * "simplified" away by a later change:
 *
 *  1. **The address is written to Firestore as well as to Stripe.** The org's
 *     `contact.address` is what `/api/orgs/settings` pushes to the Stripe
 *     customer on every profile save. A card that wrote only Stripe would be
 *     silently undone by the next unrelated Organization Settings save, which
 *     would push the OLD address straight back over it.
 *  2. **A blank address is refused, not obeyed.** Clearing it would stop
 *     `automatic_tax` computing and put an addressless invoice in front of a
 *     tax authority. Emptying a form is not a request to do that.
 *
 * `fetch` is mocked; the captured request is the assertion surface. No live
 * Stripe call happens here.
 */

// A module, not a script — without this the const declarations below collide
// with the other billing route specs' identical globals under `tsc`.
export {}

const mockVerifyIdToken = jest.fn()
const mockReadOrgBilling = jest.fn()
const mockLogOrgActivity = jest.fn()
const mockOrgSet = jest.fn()
const mockPermission = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({ set: (...args: unknown[]) => mockOrgSet(...args) }),
        }),
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
  readOrgBillingCustomerModes: async () => ({ live: false, test: false }),
  logOrgActivity: (...args: unknown[]) => mockLogOrgActivity(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL normalizer, not a re-typed one. The country rule — ISO-3166
  // alpha-2 or nothing, because Stripe Tax cannot compute from a country name
  // — lives there, and a double would let this suite pass while it changed.
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
/** What the mocked Stripe customer currently holds; writes update it. */
let storedCustomer: Record<string, any> = {}

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

beforeEach(() => {
  // Module-scope `jest.fn()`s keep their history across tests and
  // `restoreAllMocks` does not touch them.
  jest.clearAllMocks()
  calls = []
  storedCustomer = {
    email: 'owner@example.com',
    name: null,
    address: null,
    invoice_settings: {},
  }
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-1',
    email: 'owner@example.com',
    email_verified: true,
  })
  mockReadOrgBilling.mockResolvedValue({ stripeCustomerId: 'cus_test_1' })
  mockOrgSet.mockResolvedValue(undefined)
  mockPermission.mockResolvedValue(true)
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    const href = String(url)
    const method = String(init?.method ?? 'GET')
    const body = init?.body ? new URLSearchParams(String(init.body)) : null
    calls.push({ url: href, method, body })
    // A customer WRITE mutates the stored record, so the read that follows in
    // the same request returns what was just saved. That is what makes this a
    // round-trip rather than two unrelated assertions.
    if (method === 'POST' && /\/customers\/[^/]+$/.test(href) && body) {
      if (body.get('email')) storedCustomer.email = body.get('email')
      if (body.get('name')) storedCustomer.name = body.get('name')
      const line1 = body.get('address[line1]')
      const country = body.get('address[country]')
      if (country) {
        storedCustomer.address = {
          line1: line1 ?? null,
          line2: body.get('address[line2]'),
          city: body.get('address[city]'),
          state: body.get('address[state]'),
          postal_code: body.get('address[postal_code]'),
          country,
        }
      }
      return { ok: true, status: 200, json: async () => storedCustomer }
    }
    if (/\/customers\/[^/]+$/.test(href)) {
      return { ok: true, status: 200, json: async () => storedCustomer }
    }
    return { ok: true, status: 200, json: async () => ({ data: [] }) }
  }) as never
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  jest.restoreAllMocks()
})

describe('the billing email round-trips', () => {
  it('writes what was typed and returns what Stripe then holds', async () => {
    const handler = loadRoute()
    const response = await post(handler, {
      action: 'set-billing-email',
      email: 'invoices@example.com',
    })
    expect(response.status).toBe(200)
    const write = calls.find(
      (call) => call.method === 'POST' && /\/customers\//.test(call.url),
    )
    expect(write?.body?.get('email')).toBe('invoices@example.com')
    const payload = await response.json()
    expect(payload.customer.email).toBe('invoices@example.com')
  })

  it('refuses a malformed address without calling Stripe', async () => {
    const handler = loadRoute()
    const response = await post(handler, {
      action: 'set-billing-email',
      email: 'not-an-email',
    })
    expect(response.status).toBe(400)
    expect(
      calls.some((call) => call.method === 'POST' && /\/customers\//.test(call.url)),
    ).toBe(false)
  })

  it('does not mirror the billing email onto the org document', async () => {
    // Stripe is the store of record for this one field. A second copy on the
    // org doc would only create a way for the two to disagree about the
    // address Stripe will actually mail — and the org's `contact.email` is a
    // different, public-facing thing.
    const handler = loadRoute()
    await post(handler, {
      action: 'set-billing-email',
      email: 'invoices@example.com',
    })
    expect(mockOrgSet).not.toHaveBeenCalled()
  })
})

describe('the billing address round-trips', () => {
  const ADDRESS = {
    action: 'set-billing-address',
    name: 'Example Co',
    line1: '1 Example Street',
    line2: 'Suite 2',
    city: 'Austin',
    state: 'TX',
    postalCode: '78701',
    country: 'US',
  }

  it('sends every field Stripe Tax needs, and reads them back', async () => {
    const handler = loadRoute()
    const response = await post(handler, ADDRESS)
    expect(response.status).toBe(200)
    const write = calls.find(
      (call) => call.method === 'POST' && /\/customers\//.test(call.url),
    )
    expect(write?.body?.get('name')).toBe('Example Co')
    expect(write?.body?.get('address[line1]')).toBe('1 Example Street')
    expect(write?.body?.get('address[line2]')).toBe('Suite 2')
    expect(write?.body?.get('address[city]')).toBe('Austin')
    expect(write?.body?.get('address[state]')).toBe('TX')
    expect(write?.body?.get('address[postal_code]')).toBe('78701')
    expect(write?.body?.get('address[country]')).toBe('US')

    const payload = await response.json()
    expect(payload.customer.name).toBe('Example Co')
    expect(payload.customer.address).toEqual({
      line1: '1 Example Street',
      line2: 'Suite 2',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
      country: 'US',
    })
  })

  it('mirrors onto the org so the settings page cannot push a stale one back', async () => {
    // `/api/orgs/settings` pushes `contact.address` to Stripe on every profile
    // save. Writing only Stripe here would be undone by the next unrelated
    // save on that page — invisibly, because the console would show the new
    // address and every invoice would carry the old one.
    const handler = loadRoute()
    await post(handler, ADDRESS)
    expect(mockOrgSet).toHaveBeenCalled()
    const written = mockOrgSet.mock.calls[0]?.[0]
    expect(written.contact.address).toEqual({
      line1: '1 Example Street',
      line2: 'Suite 2',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
      country: 'US',
    })
    // And the divergence flags are cleared, because the push succeeded.
    expect(written.billing.addressDivergedFromStripe).toBe(false)
    expect(written.billing.addressDivergedReason).toBeNull()
  })

  it('refuses a country that is not an ISO alpha-2 code', async () => {
    // `normalizeAddress` drops anything else, and Stripe Tax cannot compute
    // from a typed country name — so an accepted save would silently stop tax
    // being calculated.
    const handler = loadRoute()
    const response = await post(handler, {
      ...ADDRESS,
      country: 'United States',
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('two-letter code')
  })

  it('refuses a blank save rather than clearing the address on Stripe', async () => {
    const handler = loadRoute()
    const response = await post(handler, {
      action: 'set-billing-address',
      name: '',
      line1: '',
      line2: '',
      city: '',
      state: '',
      postalCode: '',
      country: '',
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('does not remove')
    expect(
      calls.some((call) => call.method === 'POST' && /\/customers\//.test(call.url)),
    ).toBe(false)
    expect(mockOrgSet).not.toHaveBeenCalled()
  })

  it('CONTROL — a complete address really does reach Stripe', async () => {
    // Three cases above assert that Stripe was NOT called. Each is worthless
    // if the mock were wired such that nothing ever calls Stripe; this is the
    // case that proves the wire works.
    const handler = loadRoute()
    await post(handler, ADDRESS)
    expect(
      calls.some((call) => call.method === 'POST' && /\/customers\//.test(call.url)),
    ).toBe(true)
  })
})

describe('permission', () => {
  it('a reader may look but not save', async () => {
    // `get` needs billing.view; every write needs billing.manage. A member
    // with view only must be refused BEFORE anything reaches Stripe.
    mockPermission.mockImplementation(
      async (_orgId: string, _member: unknown, permission: string) =>
        permission === 'billing.view',
    )
    const handler = loadRoute()
    expect((await post(handler, { action: 'get' })).status).toBe(200)
    const refused = await post(handler, {
      action: 'set-billing-email',
      email: 'invoices@example.com',
    })
    expect(refused.status).toBe(403)
    expect((await refused.json()).error).toContain('billing.manage')
    expect(
      calls.some((call) => call.method === 'POST' && /\/customers\//.test(call.url)),
    ).toBe(false)
  })
})
