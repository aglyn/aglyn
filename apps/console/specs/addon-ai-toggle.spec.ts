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
 * The Aglyn AI add-on through `/api/billing/addons` (AGL-2897).
 *
 * The route is generic over `ADDON_KINDS`, so nothing here is a branch of its
 * own — which is exactly why it needs pinning: a kind that falls out of the
 * catalog, the ceiling or the price map fails silently as "upgrade required"
 * rather than loudly. What is asserted is the shape a 0/1 toggle must have on
 * every path the route offers:
 *
 *   - `get` lists it at the plan's price with a ceiling of 1;
 *   - buying it (0 → 1) is an immediate, priced, prorated item with quantity 1;
 *   - dropping it (1 → 0) is deferred to the period end through a schedule,
 *     charged nothing, and the mirror keeps reading 1 until the phase flips;
 *   - 2 is refused, because the add-on is the whole thing.
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
  // The REAL plan model: `aiAddonMonthlyUsd` and the ceiling of 1 are what
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

const STRIPE_ENV = {
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_PRICE_STARTER: 'price_starter_monthly',
  STRIPE_PRICE_METERED: 'price_metered_usage',
  STRIPE_PRICE_STARTER_AI_ADDON: 'price_starter_ai_addon',
}

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
      price: { id: 'price_starter_monthly', recurring: { interval: 'month' } },
    },
    ...(aiItem ? [aiItem] : []),
    {
      id: 'si_metered',
      price: { id: 'price_metered_usage', recurring: { interval: 'month' } },
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
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    const href = String(url)
    const method = String(init?.method ?? 'GET')
    stripeCalls.push({ href, method, body: String(init?.body ?? '') })
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
            ...liveItems(),
            {
              id: 'si_ai',
              quantity: 1,
              price: { id: 'price_starter_ai_addon', recurring: { interval: 'month' } },
            },
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

describe('the AI add-on in the catalog (AGL-2897)', () => {
  it('is listed at the plan\'s price with a ceiling of one', async () => {
    const response = await call({ action: 'get' })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.quantities.aiAddon).toBe(0)
    expect(payload.catalog.aiAddon).toEqual({
      unitUsd: 9,
      max: 1,
      configured: true,
      upgradeRequired: false,
    })
  })

  it('reads as unconfigured — not as unsold — when its env is unset', async () => {
    const { STRIPE_PRICE_STARTER_AI_ADDON: _unset, ...withoutPrice } = STRIPE_ENV
    void _unset
    const payload = await (await call({ action: 'get' }, withoutPrice)).json()
    expect(payload.catalog.aiAddon.configured).toBe(false)
    expect(payload.catalog.aiAddon.upgradeRequired).toBe(false)
    const refused = await call({ action: 'set', kind: 'aiAddon', quantity: 1 }, withoutPrice)
    expect(refused.status).toBe(501)
  })
})

describe('buying the AI add-on is immediate (AGL-2897)', () => {
  it('is quoted through invoices/upcoming as a quantity-1 item', async () => {
    const response = await call({ action: 'preview', kind: 'aiAddon', quantity: 1 })
    expect(response.status).toBe(200)
    const quote = stripeCall('GET', '/invoices/upcoming')
    expect(quote).toBeDefined()
    const query = new URL(quote!.href).searchParams
    expect(query.get('subscription_items[0][price]')).toBe('price_starter_ai_addon')
    expect(query.get('subscription_items[0][quantity]')).toBe('1')
    expect((await response.json()).amountDueCents).toBe(646)
  })

  it('adds the item at quantity 1 and mirrors aiAddon: 1', async () => {
    const response = await call({ action: 'set', kind: 'aiAddon', quantity: 1 })
    expect(response.status).toBe(200)
    const update = stripeCall('POST', '/subscriptions/sub_1')
    expect(update).toBeDefined()
    const body = new URLSearchParams(update!.body)
    expect(body.get('items[0][price]')).toBe('price_starter_ai_addon')
    expect(body.get('items[0][quantity]')).toBe('1')
    expect(stripeCall('POST', '/subscription_schedules')).toBeUndefined()
    expect(orgMirrorWrites).toHaveLength(1)
    expect(orgMirrorWrites[0].seatAddons.aiAddon).toBe(1)
  })

  it("raises the add-on change for the plugin's feed writer, attributed to the buyer (AGL-2929)", async () => {
    await call({ action: 'set', kind: 'aiAddon', quantity: 1 })
    expect(mockActivityRows).toEqual([
      [
        {
          orgId: ORG_ID,
          actor: { uid: 'user-1', email: 'owner@example.test' },
          // The mirror read before the write: the plugin's handler compares it
          // with `after` and writes a row only when the AI add-on moved.
          before: {},
          after: expect.objectContaining({ aiAddon: 1 }),
        },
      ],
    ])
  })

  it('another add-on kind writes no AI row', async () => {
    await call({ action: 'set', kind: 'hosts', quantity: 1 })
    expect(mockActivityRows).toEqual([])
  })

  it('refuses a second one — the add-on is the whole thing', async () => {
    const response = await call({ action: 'set', kind: 'aiAddon', quantity: 2 })
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('invalid_quantity')
    expect(stripeCall('POST', '/subscriptions/sub_1')).toBeUndefined()
  })
})

describe('dropping the AI add-on waits for the period end (AGL-2897)', () => {
  beforeEach(() => {
    orgDoc = { plan: 'starter', seatAddons: { aiAddon: 1 } }
    aiItem = {
      id: 'si_ai',
      quantity: 1,
      price: { id: 'price_starter_ai_addon', recurring: { interval: 'month' } },
    }
  })

  it('writes a schedule instead of updating the subscription', async () => {
    const response = await call({ action: 'set', kind: 'aiAddon', quantity: 0 })
    expect(response.status).toBe(200)
    expect(stripeCall('POST', '/subscriptions/sub_1')).toBeUndefined()
    const schedule = stripeCall('POST', '/subscription_schedules/sub_sched_1')
    expect(schedule).toBeDefined()
    const body = new URLSearchParams(schedule!.body)
    expect(body.get('proration_behavior')).toBe('none')
    // The target phase carries the plan and metered items and NOT the add-on.
    const targetPrices: string[] = []
    for (let i = 0; ; i += 1) {
      const price = body.get(`phases[1][items][${i}][price]`)
      if (!price) break
      targetPrices.push(price)
    }
    expect(targetPrices).toContain('price_starter_monthly')
    expect(targetPrices).not.toContain('price_starter_ai_addon')
  })

  it('names the pending change and keeps the mirror at 1 until then', async () => {
    const payload = await (await call({ action: 'set', kind: 'aiAddon', quantity: 0 })).json()
    expect(payload.pendingAddonChange).toMatchObject({ kind: 'aiAddon', quantity: 0 })
    expect(payload.pendingAddonChange.effectiveAt).toBe(
      new Date(PERIOD_END * 1000).toISOString(),
    )
    expect(payload.quantities.aiAddon).toBe(1)
    expect(orgMirrorWrites).toHaveLength(0)
  })

  it('quotes the removal as deferred, without pricing it', async () => {
    const payload = await (await call({ action: 'preview', kind: 'aiAddon', quantity: 0 })).json()
    expect(stripeCall('GET', '/invoices/upcoming')).toBeUndefined()
    expect(payload.defersToPeriodEnd).toBe(true)
    expect(payload.amountDueCents).toBe(0)
  })
})
