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
 * An add-on increase is granted once it is PAID (AGL-3358).
 *
 * The increase was already invoiced immediately (`always_invoice`), but the
 * item change applied whatever happened to the charge: a declined card or a
 * pending 3DS challenge still got the seats, and this route mirrored the new
 * quantity onto `org.seatAddons` — the entitlement input — beside an unpaid
 * invoice. The plan switch's pay-later leak, one door over.
 *
 * `pending_if_incomplete` holds the change in `pending_update` until the
 * invoice is paid, so an unpaid increase leaves the subscription, the mirror
 * and the entitlement on the quantity that was paid for, and hands the page
 * what it needs to finish the charge.
 *
 * NO STRIPE PATH IS EXERCISED. `fetch` is mocked and never calls out.
 */

export {}

const ORG_ID = 'org-1'
const PERIOD_END = 1767225600

let stripeCalls: Array<{ href: string; method: string; body: string }> = []
/** Everything written to the org doc — `seatAddons` is the entitlement input. */
let orgMirrorWrites: any[] = []
/** The live subscription's automatic tax, as Stripe serializes it. */
let automaticTax: { enabled: boolean }
/** What `POST subscriptions/sub_1` answers — the outcome of the charge. */
let updateAnswer: Record<string, unknown>

const orgRef = {
  get: async () => ({
    data: () => ({ plan: 'starter' }),
    ref: {
      set: async (value: unknown) => {
        orgMirrorWrites.push(value)
      },
    },
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'user-1', email_verified: true }),
      }),
      firestore: () => ({ collection: () => ({ doc: () => orgRef }) }),
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Email unverified' }, { status: 403 }),
  isImpersonationSession: () => false,
  memberHasOrgPermission: async () => true,
  readOrgBilling: async () => ({ stripeCustomerId: 'cus_test_1' }),
  resolveOrgMembership: async () => ({ member: { role: 'owner' } }),
  isServerReleaseFlagOnForOrg: async () => true,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  isLiveSubscriptionStatus: jest.requireActual(
    '@aglyn/aglyn/app-utils/org-billing-doc',
  ).isLiveSubscriptionStatus,
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  runPluginEventHandlers: async () => undefined,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
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
const ORIGINAL_FETCH = global.fetch

const STRIPE_ENV = {
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_PRICE_STARTER: 'price_starter_monthly',
  STRIPE_PRICE_METERED: 'price_metered_usage',
  STRIPE_PRICE_STARTER_EXTRA_DATASET: 'price_starter_dataset',
}

const LIVE_ITEMS = [
  {
    id: 'si_plan',
    quantity: 1,
    price: { id: 'price_starter_monthly', recurring: { interval: 'month' } },
  },
  {
    id: 'si_dataset',
    quantity: 1,
    price: { id: 'price_starter_dataset', recurring: { interval: 'month' } },
  },
  {
    id: 'si_metered',
    price: { id: 'price_metered_usage', recurring: { interval: 'month' } },
  },
]

const PAID = {
  id: 'sub_1',
  status: 'active',
  pending_update: null,
  items: {
    data: [
      { id: 'si_plan', quantity: 1, price: { id: 'price_starter_monthly' } },
      { id: 'si_dataset', quantity: 5, price: { id: 'price_starter_dataset' } },
    ],
  },
  latest_invoice: {
    status: 'paid',
    amount_due: 1600,
    currency: 'usd',
    payment_intent: { status: 'succeeded' },
  },
}

/** The test-mode shape of an increase held for the bank's challenge. */
const HELD_FOR_3DS = {
  id: 'sub_1',
  status: 'active',
  pending_update: {
    expires_at: 1790685512,
    subscription_items: [{ id: 'si_dataset', quantity: 5 }],
  },
  // The LIVE items are untouched while the update is held.
  items: { data: LIVE_ITEMS },
  latest_invoice: {
    status: 'open',
    amount_due: 1600,
    currency: 'usd',
    hosted_invoice_url: 'https://invoice.stripe.com/i/held',
    payment_intent: {
      status: 'requires_action',
      client_secret: 'pi_addon_secret_1',
    },
  },
}

const HELD_DECLINED = {
  ...HELD_FOR_3DS,
  latest_invoice: {
    ...HELD_FOR_3DS.latest_invoice,
    payment_intent: { status: 'requires_payment_method' },
  },
}

function loadAddons() {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, ...STRIPE_ENV } as NodeJS.ProcessEnv
  return require('../app/api/billing/addons/route').POST as (
    request: Request,
  ) => Promise<Response>
}

function setDatasets(
  post: (request: Request) => Promise<Response>,
  quantity: number,
) {
  return post(
    new Request('https://app.aglyn.com/api/billing/addons', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        orgId: ORG_ID,
        action: 'set',
        kind: 'datasets',
        quantity,
      }),
    }),
  )
}

function subscriptionPosts(): URLSearchParams[] {
  return stripeCalls
    .filter((c) => c.method === 'POST' && c.href.includes('/subscriptions/sub_1'))
    .map((c) => new URLSearchParams(c.body))
}

function itemUpdate(): URLSearchParams | undefined {
  return subscriptionPosts().find((body) => body.get('items[0][id]'))
}

beforeEach(() => {
  stripeCalls = []
  orgMirrorWrites = []
  automaticTax = { enabled: true }
  updateAnswer = PAID
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    const href = String(url)
    stripeCalls.push({
      href,
      method: String(init?.method ?? 'GET'),
      body: String(init?.body ?? ''),
    })
    let payload: unknown
    if (href.includes('/subscriptions?customer=')) {
      payload = {
        data: [
          {
            id: 'sub_1',
            status: 'active',
            currency: 'usd',
            current_period_end: PERIOD_END,
            automatic_tax: automaticTax,
            metadata: { plan: 'starter', orgId: ORG_ID },
            items: { data: LIVE_ITEMS },
          },
        ],
      }
    } else if (href.includes('/subscriptions/sub_1')) {
      const body = new URLSearchParams(String(init?.body ?? ''))
      // Stripe's own refusal: `automatic_tax` cannot ride a pending update.
      if (
        body.get('payment_behavior') === 'pending_if_incomplete' &&
        body.has('automatic_tax[enabled]')
      ) {
        return {
          ok: false,
          json: async () => ({
            error: { message: '`automatic_tax` is not supported.' },
          }),
        }
      }
      payload = body.get('items[0][id]') ? updateAnswer : { status: 'active' }
    } else {
      throw new Error(`unexpected fetch: ${href}`)
    }
    return { ok: true, json: async () => payload }
  }) as never
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  global.fetch = ORIGINAL_FETCH
  jest.restoreAllMocks()
})

describe('an add-on increase is charged now and granted once paid (AGL-3358)', () => {
  it('updates with always_invoice + pending_if_incomplete', async () => {
    const post = loadAddons()
    expect((await setDatasets(post, 5)).status).toBe(200)
    const body = itemUpdate()
    expect(body?.get('items[0][quantity]')).toBe('5')
    expect(body?.get('proration_behavior')).toBe('always_invoice')
    expect(body?.get('payment_behavior')).toBe('pending_if_incomplete')
    expect(body?.has('automatic_tax[enabled]')).toBe(false)
  })

  it('a PAID increase mirrors the new quantity', async () => {
    const post = loadAddons()
    const payload = await (await setDatasets(post, 5)).json()
    expect(payload.ok).toBe(true)
    expect(payload.chargePaid).toBe(true)
    expect(payload.quantities.datasets).toBe(5)
    expect(orgMirrorWrites).toEqual([
      expect.objectContaining({
        seatAddons: expect.objectContaining({ datasets: 5 }),
      }),
    ])
  })

  it('THE LEAK: an increase held for 3DS grants nothing and hands back the challenge', async () => {
    updateAnswer = HELD_FOR_3DS
    const post = loadAddons()
    const response = await setDatasets(post, 5)
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(orgMirrorWrites).toEqual([])
    expect(payload.ok).toBe(false)
    expect(payload.paymentPending).toBe(true)
    expect(payload.requiresAction).toBe(true)
    expect(payload.paymentClientSecret).toBe('pi_addon_secret_1')
    expect(payload.hostedInvoiceUrl).toBe('https://invoice.stripe.com/i/held')
    expect(payload.chargedNowCents).toBe(1600)
    // What the workspace has is what it paid for.
    expect(payload.quantities.datasets).toBe(1)
  })

  it('THE LEAK: a declined increase grants nothing and says it was declined', async () => {
    updateAnswer = HELD_DECLINED
    const post = loadAddons()
    const payload = await (await setDatasets(post, 5)).json()
    expect(orgMirrorWrites).toEqual([])
    expect(payload.paymentPending).toBe(true)
    expect(payload.declined).toBe(true)
    expect(payload.paymentClientSecret).toBeUndefined()
    expect(payload.quantities.datasets).toBe(1)
  })

  it('turns automatic tax on in its own call first when Stripe reports it off', async () => {
    automaticTax = { enabled: false }
    const post = loadAddons()
    expect((await setDatasets(post, 5)).status).toBe(200)
    const posts = subscriptionPosts()
    expect(posts).toHaveLength(2)
    expect(posts[0].get('automatic_tax[enabled]')).toBe('true')
    expect(posts[0].get('proration_behavior')).toBe('none')
    expect(posts[1].get('payment_behavior')).toBe('pending_if_incomplete')
  })
})
