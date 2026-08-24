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
 * A no-op add-on quantity change must not touch Stripe (AGL-2486).
 *
 * REAL EVIDENCE, live Stripe: invoice #3VKIUCFB-0002, Test Org, 18 Jul –
 * 18 Aug 2026, total $0.00 —
 *
 *   Remaining time on Aglyn Starter — extra dataset after 18 Jul   $2.00  Qty 1
 *   Unused time on Aglyn Starter — extra dataset after 18 Jul     -$2.00  Qty 1
 *
 * A credit and a charge on the SAME item, at the SAME price, for the SAME
 * period, cancelling exactly. That is Stripe's proration pair for a
 * subscription-item update where nothing moved: `/api/billing/addons` guarded
 * only one no-op ("no item, quantity 0") and happily POSTed
 * `subscriptions/{id}` with `proration_behavior: 'create_prorations'` when the
 * requested quantity already WAS the current quantity.
 *
 * The assertion surface is therefore the Stripe call list, not the response —
 * the old code answered `ok: true` with the right quantities too. What
 * separates fixed from broken is that Stripe is never asked.
 *
 * `create_prorations` for REAL changes is deliberate (AGL-535) and is asserted
 * here as well, so a future "fix" that suppresses prorations outright — which
 * would stop billing genuine upgrades — goes red instead of green.
 *
 * NO STRIPE PATH IS EXERCISED. `fetch` is mocked and never calls out;
 * localhost carries the LIVE key.
 */

export {}

const ORG_ID = 'org-1'

/** The dataset add-on item on the subscription; `null` means no item at all. */
let datasetItem: any
/** Every Stripe request the route made, in order. */
let stripeCalls: Array<{ href: string; method: string; body: string }> = []
/** Everything written to `org.seatAddons`. */
let orgMirrorWrites: any[] = []

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
  // The REAL plan model — the ceiling that decides whether a 5-dataset
  // purchase is even legal has to be the one the product sells (Starter
  // includes 3 of a 10 maximum, so 0..7 is purchasable).
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
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

function loadAddons() {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, ...STRIPE_ENV } as NodeJS.ProcessEnv
  return require('../app/api/billing/addons/route').POST as (
    request: Request,
  ) => Promise<Response>
}

function call(
  post: (request: Request) => Promise<Response>,
  body: Record<string, unknown>,
) {
  return post(
    new Request('https://app.aglyn.com/api/billing/addons', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ orgId: ORG_ID, ...body }),
    }),
  )
}

/** Set the dataset add-on to `quantity`; `undefined` omits the field entirely. */
function setDatasets(
  post: (request: Request) => Promise<Response>,
  quantity: number,
) {
  return call(post, { action: 'set', kind: 'datasets', quantity })
}

/**
 * The Stripe traffic that is NOT the unavoidable "which subscription does this
 * customer have" lookup — i.e. everything that can move money or quote it.
 */
function billingCalls() {
  return stripeCalls.filter(
    (entry) => !entry.href.includes('/subscriptions?customer='),
  )
}

/** The captured body of the one `POST subscriptions/{id}`. */
function subscriptionUpdate(): URLSearchParams | null {
  const entry = stripeCalls.find(
    (call) => call.method === 'POST' && call.href.includes('/subscriptions/sub_1'),
  )
  return entry ? new URLSearchParams(entry.body) : null
}

beforeEach(() => {
  // The invoice's own shape: Starter, one extra dataset.
  datasetItem = {
    id: 'si_dataset',
    quantity: 1,
    price: { id: 'price_starter_dataset', recurring: { interval: 'month' } },
  }
  stripeCalls = []
  orgMirrorWrites = []
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
            items: {
              data: [
                {
                  id: 'si_plan',
                  quantity: 1,
                  price: {
                    id: 'price_starter_monthly',
                    recurring: { interval: 'month' },
                  },
                },
                ...(datasetItem ? [datasetItem] : []),
                {
                  id: 'si_metered',
                  price: {
                    id: 'price_metered_usage',
                    recurring: { interval: 'month' },
                  },
                },
              ],
            },
          },
        ],
      }
    } else if (href.includes('/invoices/upcoming')) {
      payload = {
        amount_due: 0,
        currency: 'usd',
        lines: { data: [{ proration: true, amount: 200 }] },
      }
    } else if (href.includes('/subscriptions/sub_1')) {
      payload = {
        id: 'sub_1',
        status: 'active',
        items: {
          data: [
            {
              id: 'si_plan',
              quantity: 1,
              price: { id: 'price_starter_monthly' },
            },
            { id: 'si_dataset', quantity: 3, price: { id: 'price_starter_dataset' } },
          ],
        },
      }
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

describe('a no-op add-on quantity change never reaches Stripe (AGL-2486)', () => {
  it('setting the quantity it already has makes ZERO billing calls', async () => {
    // Invoice #3VKIUCFB-0002 exactly: one extra dataset, set to one.
    const post = loadAddons()
    const response = await setDatasets(post, 1)
    expect(response.status).toBe(200)
    expect(billingCalls()).toEqual([])
  })

  it('...and still answers with the quantities the org actually has', async () => {
    // The no-op must be indistinguishable to the caller from a change that
    // landed — the card re-renders off this payload.
    const post = loadAddons()
    const payload = await (await setDatasets(post, 1)).json()
    expect(payload.ok).toBe(true)
    expect(payload.quantities.datasets).toBe(1)
    expect(payload.quantities.managers).toBe(0)
  })

  it('...and writes no seatAddons mirror, because nothing moved', async () => {
    const post = loadAddons()
    await setDatasets(post, 1)
    expect(orgMirrorWrites).toEqual([])
  })

  it('a PREVIEW of the same quantity quotes zero without asking Stripe', async () => {
    const post = loadAddons()
    const response = await call(post, {
      action: 'preview',
      kind: 'datasets',
      quantity: 1,
    })
    expect(billingCalls()).toEqual([])
    const payload = await response.json()
    expect(payload.amountDueCents).toBe(0)
    // The card reads `prorationCents ?? amountDueCents`; a no-op quote has to
    // carry the same field a real quote does, or the two answers differ in
    // shape for no reason.
    expect(payload.prorationCents).toBe(0)
    expect(payload.currency).toBe('usd')
  })
})

describe('REAL changes still reach Stripe and still prorate (AGL-535)', () => {
  it('an increase updates the item with create_prorations', async () => {
    const post = loadAddons()
    expect((await setDatasets(post, 5)).status).toBe(200)
    const body = subscriptionUpdate()
    expect(body?.get('items[0][id]')).toBe('si_dataset')
    expect(body?.get('items[0][quantity]')).toBe('5')
    expect(body?.get('proration_behavior')).toBe('create_prorations')
  })

  it('a decrease updates the item with create_prorations', async () => {
    datasetItem.quantity = 5
    const post = loadAddons()
    expect((await setDatasets(post, 1)).status).toBe(200)
    const body = subscriptionUpdate()
    expect(body?.get('items[0][quantity]')).toBe('1')
    expect(body?.get('proration_behavior')).toBe('create_prorations')
  })

  it('a removal deletes the item with create_prorations', async () => {
    const post = loadAddons()
    expect((await setDatasets(post, 0)).status).toBe(200)
    const body = subscriptionUpdate()
    expect(body?.get('items[0][id]')).toBe('si_dataset')
    expect(body?.get('items[0][deleted]')).toBe('true')
    expect(body?.get('items[0][quantity]')).toBeNull()
    expect(body?.get('proration_behavior')).toBe('create_prorations')
  })

  it('a first purchase adds the item with create_prorations', async () => {
    datasetItem = null
    const post = loadAddons()
    expect((await setDatasets(post, 2)).status).toBe(200)
    const body = subscriptionUpdate()
    expect(body?.get('items[0][price]')).toBe('price_starter_dataset')
    expect(body?.get('items[0][quantity]')).toBe('2')
    expect(body?.get('proration_behavior')).toBe('create_prorations')
  })

  it('a REAL preview still asks Stripe to quote it', async () => {
    const post = loadAddons()
    const response = await call(post, {
      action: 'preview',
      kind: 'datasets',
      quantity: 5,
    })
    expect(
      billingCalls().filter((entry) => entry.href.includes('/invoices/upcoming')),
    ).toHaveLength(1)
    expect(billingCalls()[0].href).toContain(
      'subscription_proration_behavior=create_prorations',
    )
    expect((await response.json()).prorationCents).toBe(200)
  })
})

/**
 * `strictNullChecks` is OFF repo-wide, so nothing in the compiler distinguishes
 * these three. 0 is a legitimate quantity and an ABSENT quantity is not the
 * same value as zero — fold them together and a removal silently stops
 * happening, which is a worse bug than the one being fixed.
 */
describe('quantity 0 vs absent vs no item at all', () => {
  it('an item with NO quantity field is still REMOVED, not short-circuited', async () => {
    // `Number(undefined)` is NaN, and a `|| 0` here would read this item as
    // "already zero" and answer ok:true having deleted nothing — the add-on
    // keeps billing while the console says it is gone.
    datasetItem = {
      id: 'si_dataset',
      price: { id: 'price_starter_dataset', recurring: { interval: 'month' } },
    }
    const post = loadAddons()
    expect((await setDatasets(post, 0)).status).toBe(200)
    expect(subscriptionUpdate()?.get('items[0][deleted]')).toBe('true')
  })

  it('an item with NO quantity field is still SETTABLE to a real quantity', async () => {
    datasetItem = {
      id: 'si_dataset',
      price: { id: 'price_starter_dataset', recurring: { interval: 'month' } },
    }
    const post = loadAddons()
    expect((await setDatasets(post, 4)).status).toBe(200)
    expect(subscriptionUpdate()?.get('items[0][quantity]')).toBe('4')
  })

  it('NO ITEM and quantity 0 is the original no-op — still no Stripe call', async () => {
    datasetItem = null
    const post = loadAddons()
    expect((await setDatasets(post, 0)).status).toBe(200)
    expect(billingCalls()).toEqual([])
  })

  it('an item ALREADY at quantity 0 set to 0 makes no Stripe call', async () => {
    datasetItem = {
      id: 'si_dataset',
      quantity: 0,
      price: { id: 'price_starter_dataset', recurring: { interval: 'month' } },
    }
    const post = loadAddons()
    expect((await setDatasets(post, 0)).status).toBe(200)
    expect(billingCalls()).toEqual([])
  })

  it('an item at quantity 0 raised to 2 DOES reach Stripe', async () => {
    datasetItem = {
      id: 'si_dataset',
      quantity: 0,
      price: { id: 'price_starter_dataset', recurring: { interval: 'month' } },
    }
    const post = loadAddons()
    expect((await setDatasets(post, 2)).status).toBe(200)
    expect(subscriptionUpdate()?.get('items[0][quantity]')).toBe('2')
  })
})
