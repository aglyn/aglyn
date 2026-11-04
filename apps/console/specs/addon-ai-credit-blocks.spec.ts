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
 * Aglyn AI credits through `/api/billing/addons` (AGL-2897), sold BY THE
 * BLOCK since AGL-4144: 5,000 credits for $10 a month, any quantity from 1 to
 * 30, on any paid plan.
 *
 * The route is generic over `ADDON_KINDS`, so most of this is no branch of
 * its own — which is exactly why it needs pinning: a kind that falls out of
 * the catalog, the ceiling or the price map fails silently as "upgrade
 * required" rather than loudly. What is asserted is the shape a quantity
 * add-on must have on every path the route offers, the same as POS
 * registers:
 *
 *   - `get` lists it at $10 a block with a ceiling of 30 and the credits one
 *     block adds, and lists no tier;
 *   - buying or adding blocks is an immediate, priced, prorated item change
 *     at the block price matching the subscription's interval;
 *   - removing blocks waits for the period end through a schedule, charged
 *     nothing, and the mirror keeps reading the held count until the flip;
 *   - 31 is refused, and so is any request that names a retired tier.
 *
 * Harness lifted from `addon-reduction-defers-to-period-end.spec.ts`. NO
 * STRIPE PATH IS EXERCISED: `fetch` is mocked and never calls out.
 */

export {}

const ORG_ID = 'org-1'
const PERIOD_END = 1767225600
const PERIOD_START = PERIOD_END - 2592000

let orgDoc: any
/** The add-on item on the subscription, when the org already holds it. */
let aiItem: any
let stripeCalls: Array<{ href: string; method: string; body: string }> = []
let orgMirrorWrites: any[] = []
/** Every `org.seatAddons.changed` event the route raised (AGL-2929, AGL-2939). */
let mockActivityRows: unknown[][] = []

jest.mock('../../../libs/tenant/data/admin/src/lib/server/organizations', () => ({
  __esModule: true,
  logOrgActivity: async (...args: unknown[]) => {
    mockActivityRows.push(args)
  },
  logHostActivity: async () => undefined,
}))

const orgRef = {
  get: async () => ({
    data: () => orgDoc,
    ref: {
      set: async (value: unknown) => {
        orgMirrorWrites.push(value)
      },
    },
  }),
  collection: () => ({
    count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
    where: () => ({ get: async () => ({ docs: [] }) }),
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({
          uid: 'user-1',
          email: 'owner@example.test',
          email_verified: true,
        }),
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
  listOrgMembers: async () => [],
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The event the route raises (AGL-2939); the AI plugin's handler — proven
  // in its own spec — is what writes the row.
  runPluginEventHandlers: async (_event: string, payload: unknown) => {
    mockActivityRows.push([payload])
    return { handled: 1, failed: [] }
  },
  isLiveSubscriptionStatus: jest.requireActual(
    '@aglyn/aglyn/app-utils/org-billing-doc',
  ).isLiveSubscriptionStatus,
  // The REAL plan model: the block's price and the ceiling of 30 are what
  // the catalog and the quantity gate are asserted against.
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

const STRIPE_ENV: Record<string, string> = {
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_PRICE_STARTER: 'price_starter_monthly',
  STRIPE_PRICE_STARTER_YEARLY: 'price_starter_yearly',
  STRIPE_PRICE_METERED: 'price_metered_usage',
  STRIPE_PRICE_METERED_YEARLY: 'price_metered_usage_yearly',
  // The block (AGL-4144), the same price ids on every plan.
  STRIPE_PRICE_AI_CREDITS: 'price_ai_credits',
  STRIPE_PRICE_AI_CREDITS_YEARLY: 'price_ai_credits_yearly',
  // A retired tier price, still configured somewhere: nothing may read it.
  STRIPE_PRICE_AI_STUDIO: 'price_ai_studio',
}

/** The interval the plan item recurs on, for the yearly path. */
let planInterval: 'month' | 'year' = 'month'

/** The AI line on the subscription: `quantity` blocks at a price. */
const aiLine = (price: string, quantity = 1) => ({
  id: 'si_ai',
  quantity,
  price: { id: price, recurring: { interval: planInterval } },
})

/** The price and quantity the route's update set, so the mock can echo them. */
let updatedAiPrice = 'price_ai_credits'
let updatedAiQuantity = 1

function loadAddons(env: Record<string, string> = STRIPE_ENV) {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, ...env } as NodeJS.ProcessEnv
  return require('../app/api/billing/addons/route').POST as (
    request: Request,
  ) => Promise<Response>
}

function call(body: Record<string, unknown>, env?: Record<string, string>) {
  return loadAddons(env)(
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

function liveItems() {
  return [
    {
      id: 'si_plan',
      quantity: 1,
      price: {
        id: planInterval === 'year' ? 'price_starter_yearly' : 'price_starter_monthly',
        recurring: { interval: planInterval },
      },
    },
    ...(aiItem ? [aiItem] : []),
    {
      id: 'si_metered',
      price: {
        id: planInterval === 'year' ? 'price_metered_usage_yearly' : 'price_metered_usage',
        recurring: { interval: planInterval },
      },
    },
  ]
}

function stripeCall(method: string, fragment: string) {
  return stripeCalls.find(
    (entry) => entry.method === method && entry.href.includes(fragment),
  )
}

beforeEach(() => {
  stripeCalls = []
  orgMirrorWrites = []
  mockActivityRows = []
  orgDoc = { plan: 'starter', seatAddons: {} }
  aiItem = null
  planInterval = 'month'
  updatedAiPrice = 'price_ai_credits'
  updatedAiQuantity = 1
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    const href = String(url)
    const method = String(init?.method ?? 'GET')
    stripeCalls.push({ href, method, body: String(init?.body ?? '') })
    if (method === 'POST' && href.includes('/subscriptions/sub_1')) {
      const sent = new URLSearchParams(String(init?.body ?? ''))
      updatedAiPrice = sent.get('items[0][price]') ?? aiItem?.price?.id ?? updatedAiPrice
      updatedAiQuantity = Number(sent.get('items[0][quantity]') ?? updatedAiQuantity)
    }
    let payload: unknown
    if (href.includes('/subscriptions?customer=')) {
      payload = {
        data: [
          {
            id: 'sub_1',
            status: 'active',
            currency: 'usd',
            current_period_end: PERIOD_END,
            metadata: { plan: orgDoc.plan, orgId: ORG_ID },
            items: { data: liveItems() },
          },
        ],
      }
    } else if (href.includes('/subscription_schedules')) {
      payload = {
        id: 'sub_sched_1',
        status: 'not_started',
        end_behavior: 'release',
        phases: [
          {
            start_date: PERIOD_START,
            end_date: PERIOD_END,
            items: liveItems().map((item) => ({
              price: item.price.id,
              ...(item.quantity == null ? {} : { quantity: item.quantity }),
            })),
            automatic_tax: { enabled: true },
          },
        ],
      }
    } else if (href.includes('/invoices/upcoming')) {
      // A real proration for the rest of the month: $6.00 plus $0.46 of tax.
      payload = {
        amount_due: 646,
        tax: 46,
        currency: 'usd',
        automatic_tax: { status: 'complete' },
        lines: { data: [{ proration: true, amount: 600 }] },
      }
    } else if (href.includes('/subscriptions/sub_1')) {
      payload = {
        id: 'sub_1',
        status: 'active',
        items: {
          data: [
            ...liveItems().filter((item) => item.id !== 'si_ai'),
            aiLine(updatedAiPrice, updatedAiQuantity),
          ],
        },
        latest_invoice: { amount_due: 646, tax: 46, currency: 'usd' },
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

/** The prices on the schedule's target phase, with their quantities. */
function targetPhase(body: URLSearchParams): Array<{ price: string; quantity: string | null }> {
  const items: Array<{ price: string; quantity: string | null }> = []
  for (let i = 0; ; i += 1) {
    const price = body.get(`phases[1][items][${i}][price]`)
    if (!price) break
    items.push({ price, quantity: body.get(`phases[1][items][${i}][quantity]`) })
  }
  return items
}

describe('AI credit blocks in the catalog (AGL-2897, AGL-4144)', () => {
  it('lists the block at $10 with a ceiling of 30 and the credits one block adds, and no tier', async () => {
    const response = await call({ action: 'get' })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.quantities.aiAddon).toBe(0)
    expect(payload.catalog.aiAddon).toEqual({
      unitUsd: 10,
      max: 30,
      configured: true,
      upgradeRequired: false,
      credits: 5000,
    })
    // The tier picker's fields are gone: no client is offered a tier.
    expect(payload).not.toHaveProperty('aiTier')
    expect(payload).not.toHaveProperty('aiTiers')
  })

  it('counts the blocks the subscription carries, at the same price on any paid plan', async () => {
    orgDoc = { plan: 'starter', seatAddons: { aiAddon: 3 } }
    aiItem = aiLine('price_ai_credits', 3)
    const payload = await (await call({ action: 'get' })).json()
    expect(payload.quantities.aiAddon).toBe(3)
    expect(payload.catalog.aiAddon.unitUsd).toBe(10)
  })

  it('reads a line on a retired tier price as no blocks at all', async () => {
    orgDoc = { plan: 'starter', seatAddons: { aiAddon: 1 }, aiTier: 'studio' }
    aiItem = aiLine('price_ai_studio')
    const payload = await (await call({ action: 'get' })).json()
    expect(payload.quantities.aiAddon).toBe(0)
  })

  it('reads as unconfigured — not as unsold — when its env is unset', async () => {
    const { STRIPE_PRICE_AI_CREDITS: _unset, ...withoutPrice } = STRIPE_ENV
    void _unset
    const payload = await (await call({ action: 'get' }, withoutPrice)).json()
    expect(payload.catalog.aiAddon.configured).toBe(false)
    expect(payload.catalog.aiAddon.upgradeRequired).toBe(false)
    const refused = await call({ action: 'set', kind: 'aiAddon', quantity: 1 }, withoutPrice)
    expect(refused.status).toBe(501)
  })

  it('reads the yearly env on a yearly subscription', async () => {
    planInterval = 'year'
    const { STRIPE_PRICE_AI_CREDITS_YEARLY: _unset, ...withoutYearly } = STRIPE_ENV
    void _unset
    expect((await (await call({ action: 'get' })).json()).catalog.aiAddon.configured).toBe(true)
    expect((await (await call({ action: 'get' }, withoutYearly)).json()).catalog.aiAddon.configured).toBe(false)
  })

  it('sells none on a plan that sells none', async () => {
    orgDoc = { plan: 'free', seatAddons: {} }
    const payload = await (await call({ action: 'get' })).json()
    expect(payload.catalog.aiAddon).toMatchObject({ unitUsd: null, max: 0, upgradeRequired: true })
    expect(payload.catalog.aiAddon).not.toHaveProperty('credits')
  })
})

describe('adding blocks is immediate and prorated (AGL-2897, AGL-4144)', () => {
  it('is quoted through invoices/upcoming at the block price and the count asked for', async () => {
    const response = await call({ action: 'preview', kind: 'aiAddon', quantity: 3 })
    expect(response.status).toBe(200)
    const quote = stripeCall('GET', '/invoices/upcoming')
    expect(quote).toBeDefined()
    const query = new URL(quote!.href).searchParams
    expect(query.get('subscription_items[0][price]')).toBe('price_ai_credits')
    expect(query.get('subscription_items[0][quantity]')).toBe('3')
    expect(query.get('subscription_proration_behavior')).toBe('always_invoice')
    expect(query.get('automatic_tax[enabled]')).toBe('true')
    expect((await response.json()).amountDueCents).toBe(646)
  })

  it('adds the item at the count, charges now, and mirrors the count with no tier', async () => {
    const response = await call({ action: 'set', kind: 'aiAddon', quantity: 3 })
    expect(response.status).toBe(200)
    const update = stripeCall('POST', '/subscriptions/sub_1')
    expect(update).toBeDefined()
    const body = new URLSearchParams(update!.body)
    expect(body.get('items[0][price]')).toBe('price_ai_credits')
    expect(body.get('items[0][quantity]')).toBe('3')
    expect(body.get('proration_behavior')).toBe('always_invoice')
    expect(body.get('payment_behavior')).toBe('pending_if_incomplete')
    expect(stripeCall('POST', '/subscription_schedules')).toBeUndefined()
    expect(orgMirrorWrites).toHaveLength(1)
    expect(orgMirrorWrites[0].seatAddons.aiAddon).toBe(3)
    expect(orgMirrorWrites[0]).not.toHaveProperty('aiTier')
    const payload = await response.json()
    expect(payload.quantities.aiAddon).toBe(3)
    expect(payload).not.toHaveProperty('aiTier')
  })

  it('adds the yearly block price on a yearly subscription', async () => {
    planInterval = 'year'
    await call({ action: 'set', kind: 'aiAddon', quantity: 2 })
    const body = new URLSearchParams(stripeCall('POST', '/subscriptions/sub_1')!.body)
    expect(body.get('items[0][price]')).toBe('price_ai_credits_yearly')
    expect(body.get('items[0][quantity]')).toBe('2')
  })

  it('raises a held count on the same line, now, prorated', async () => {
    orgDoc = { plan: 'starter', seatAddons: { aiAddon: 3 } }
    aiItem = aiLine('price_ai_credits', 3)
    const response = await call({ action: 'set', kind: 'aiAddon', quantity: 5 })
    expect(response.status).toBe(200)
    const body = new URLSearchParams(stripeCall('POST', '/subscriptions/sub_1')!.body)
    expect(body.get('items[0][id]')).toBe('si_ai')
    expect(body.get('items[0][quantity]')).toBe('5')
    expect(body.get('items[0][price]')).toBeNull()
    expect(stripeCall('POST', '/subscription_schedules')).toBeUndefined()
    expect(orgMirrorWrites[0].seatAddons.aiAddon).toBe(5)
  })

  it('takes the ceiling itself: 30 blocks', async () => {
    const response = await call({ action: 'set', kind: 'aiAddon', quantity: 30 })
    expect(response.status).toBe(200)
    const body = new URLSearchParams(stripeCall('POST', '/subscriptions/sub_1')!.body)
    expect(body.get('items[0][quantity]')).toBe('30')
  })

  it('the count already held is a no-op', async () => {
    orgDoc = { plan: 'starter', seatAddons: { aiAddon: 3 } }
    aiItem = aiLine('price_ai_credits', 3)
    const response = await call({ action: 'set', kind: 'aiAddon', quantity: 3 })
    expect(response.status).toBe(200)
    expect(stripeCall('POST', '/subscriptions/sub_1')).toBeUndefined()
    expect(stripeCall('GET', '/invoices/upcoming')).toBeUndefined()
  })

  it("raises the add-on change for the plugin's feed writer, attributed to the buyer (AGL-2929)", async () => {
    await call({ action: 'set', kind: 'aiAddon', quantity: 2 })
    expect(mockActivityRows).toEqual([
      [
        {
          orgId: ORG_ID,
          actor: { uid: 'user-1', email: 'owner@example.test' },
          // The mirror read before the write: the plugin's handler compares it
          // with `after` and writes a row only when the blocks moved.
          before: {},
          after: expect.objectContaining({ aiAddon: 2 }),
        },
      ],
    ])
  })

  it('another add-on kind writes no AI row', async () => {
    await call({ action: 'set', kind: 'hosts', quantity: 1 })
    expect(mockActivityRows).toEqual([])
  })
})

describe('the block count is bounded at 0 and 30 (AGL-4144)', () => {
  it.each([31, 45, -1])('refuses %s blocks', async (quantity) => {
    const response = await call({ action: 'set', kind: 'aiAddon', quantity })
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('invalid_quantity')
    expect(stripeCall('POST', '/subscriptions/sub_1')).toBeUndefined()
  })

  it('refuses any block on a plan that sells none', async () => {
    orgDoc = { plan: 'free', seatAddons: {} }
    const response = await call({ action: 'set', kind: 'aiAddon', quantity: 1 })
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('upgrade_required')
  })
})

describe('no retired tier is accepted (AGL-4144)', () => {
  it.each(['spark', 'boost', 'studio', 'mega'])(
    'refuses a request naming the tier %s, before Stripe is asked anything',
    async (tier) => {
      for (const action of ['preview', 'set']) {
        stripeCalls = []
        const response = await call({ action, kind: 'aiAddon', quantity: 1, tier })
        expect(response.status).toBe(400)
        expect((await response.json()).code).toBe('ai_tier_retired')
        expect(stripeCall('GET', '/invoices/upcoming')).toBeUndefined()
        expect(stripeCall('POST', '/subscriptions/sub_1')).toBeUndefined()
      }
    },
  )
})

describe('removing blocks waits for the period end (AGL-2897, AGL-4144)', () => {
  beforeEach(() => {
    orgDoc = { plan: 'starter', seatAddons: { aiAddon: 5 } }
    aiItem = aiLine('price_ai_credits', 5)
  })

  it('schedules the lower count from the period end instead of updating the subscription', async () => {
    const payload = await (await call({ action: 'set', kind: 'aiAddon', quantity: 2 })).json()
    expect(stripeCall('POST', '/subscriptions/sub_1')).toBeUndefined()
    const schedule = stripeCall('POST', '/subscription_schedules/sub_sched_1')
    expect(schedule).toBeDefined()
    const body = new URLSearchParams(schedule!.body)
    expect(body.get('proration_behavior')).toBe('none')
    const phase = targetPhase(body)
    expect(phase).toContainEqual({ price: 'price_ai_credits', quantity: '2' })
    expect(phase.map((item) => item.price)).toContain('price_starter_monthly')
    // The blocks held until then are the ones paid for.
    expect(payload.pendingAddonChange).toMatchObject({ kind: 'aiAddon', quantity: 2 })
    expect(payload.pendingAddonChange).not.toHaveProperty('tier')
    expect(payload.quantities.aiAddon).toBe(5)
    expect(orgMirrorWrites).toHaveLength(0)
  })

  it('quotes a reduction as deferred, without pricing it', async () => {
    const payload = await (await call({ action: 'preview', kind: 'aiAddon', quantity: 2 })).json()
    expect(stripeCall('GET', '/invoices/upcoming')).toBeUndefined()
    expect(payload.defersToPeriodEnd).toBe(true)
    expect(payload.chargedNowCents).toBe(0)
  })

  it('drops the line from the period end at 0', async () => {
    const response = await call({ action: 'set', kind: 'aiAddon', quantity: 0 })
    expect(response.status).toBe(200)
    expect(stripeCall('POST', '/subscriptions/sub_1')).toBeUndefined()
    const body = new URLSearchParams(stripeCall('POST', '/subscription_schedules/sub_sched_1')!.body)
    const prices = targetPhase(body).map((item) => item.price)
    expect(prices).toContain('price_starter_monthly')
    expect(prices).not.toContain('price_ai_credits')
  })

  it('names the pending change and keeps the mirror at the held count until then', async () => {
    const payload = await (await call({ action: 'set', kind: 'aiAddon', quantity: 0 })).json()
    expect(payload.pendingAddonChange).toMatchObject({ kind: 'aiAddon', quantity: 0 })
    expect(payload.pendingAddonChange.effectiveAt).toBe(
      new Date(PERIOD_END * 1000).toISOString(),
    )
    expect(payload.quantities.aiAddon).toBe(5)
    expect(orgMirrorWrites).toHaveLength(0)
  })
})
