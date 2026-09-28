/**
 * @jest-environment node
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
 * The staff Coupons list reads EVERY Stripe coupon and code, and answers its
 * filters and search over that complete read (AGL-3321).
 *
 * A coupon is a Stripe object, and Stripe can neither filter nor search
 * coupons by anything the panel names (`utils/coupon-list-query.ts`). So the
 * list is the exception to "every clause on the Firestore query", and what is
 * pinned here is what makes the exception honest: Stripe paged to the end,
 * never a first page; a 413 past the bound rather than an answer from part of
 * the set; every clause and the search answered by the route over the whole
 * set; a clause the list cannot ask refused by name.
 *
 * NO LIVE STRIPE CALL HAPPENS HERE: `fetch` is replaced wholesale.
 */

export {}

const mockVerifyIdToken = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({}),
    }),
    firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' } },
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  DISCOUNT_APPROVAL_THRESHOLD_PCT: 40,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      body: undefined,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: Object.fromEntries(
        [...request.headers.entries()].map(([key, value]) => [key.toLowerCase(), value]),
      ),
    }
  },
}))

const { GET } = require('../app/api/admin/coupons/route') as {
  GET: (request: Request) => Promise<Response>
}
const { COUPON_READ_BOUND } = require('../utils/coupon-list-query') as {
  COUPON_READ_BOUND: number
}

/** Every Stripe list call, as the path it asked. */
let stripeCalls: string[]
let stripeCoupons: any[]
let stripeCodes: any[]

const coupon = (index: number, over: Record<string, unknown> = {}) => ({
  id: `cpn_${String(index).padStart(4, '0')}`,
  name: `Coupon ${index}`,
  percent_off: 10,
  amount_off: null,
  duration: 'once',
  times_redeemed: index % 3,
  valid: true,
  created: 1_700_000_000 + index,
  ...over,
})

/** Stripe's list: 100 a page, `starting_after` the cursor, `has_more` the flag. */
const page = (all: any[], path: string) => {
  const url = new URL(`https://api.stripe.com/v1/${path}`)
  const after = url.searchParams.get('starting_after')
  const limit = Number(url.searchParams.get('limit'))
  const start = after ? all.findIndex((entry) => entry.id === after) + 1 : 0
  const data = all.slice(start, start + limit)
  return { object: 'list', data, has_more: start + limit < all.length }
}

beforeEach(() => {
  jest.clearAllMocks()
  stripeCalls = []
  stripeCoupons = [
    coupon(1, { name: 'Launch week', duration: 'repeating', duration_in_months: 3 }),
    coupon(2, { name: 'Partner discount', valid: false }),
    coupon(3, { name: 'Founders', duration: 'forever', times_redeemed: 12 }),
  ]
  stripeCodes = [
    { id: 'promo_1', code: 'LAUNCH25', active: true, times_redeemed: 0, coupon: { id: 'cpn_0001' } },
  ]
  mockVerifyIdToken.mockResolvedValue({ uid: 'staff-1', email_verified: true, staff: true })
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
  ;(globalThis as any).fetch = jest.fn(async (url: string) => {
    const path = String(url).replace('https://api.stripe.com/v1/', '')
    stripeCalls.push(path)
    const body = path.startsWith('coupons') ? page(stripeCoupons, path) : page(stripeCodes, path)
    return { ok: true, status: 200, json: async () => body }
  })
})

const get = (query = '') =>
  GET(
    new Request(`https://console.aglyn.com/api/admin/coupons${query}`, {
      headers: { Authorization: 'Bearer tok' },
    }),
  )

const list = (params: Record<string, string>) =>
  get(`?${new URLSearchParams({ view: 'list', ...params }).toString()}`)

describe('GET /api/admin/coupons reads every coupon Stripe holds', () => {
  it('pages Stripe to the end, not its first hundred', async () => {
    stripeCoupons = Array.from({ length: 250 }, (_, index) => coupon(index + 1))
    const body = await (await get()).json()
    expect(body.coupons).toHaveLength(250)
    expect(stripeCalls.filter((path) => path.startsWith('coupons'))).toEqual([
      'coupons?limit=100',
      'coupons?limit=100&starting_after=cpn_0100',
      'coupons?limit=100&starting_after=cpn_0200',
    ])
  })

  it('refuses past the bound rather than answer from part of the set', async () => {
    stripeCoupons = Array.from({ length: COUPON_READ_BOUND + 1 }, (_, index) => coupon(index + 1))
    const response = await list({})
    expect(response.status).toBe(413)
    expect((await response.json()).error).toContain(String(COUPON_READ_BOUND))
  })

  it('gives the apply picker the whole set, unfiltered, in its own shape', async () => {
    const body = await (await get()).json()
    expect(body.coupons.map((row: any) => row.id)).toEqual(['cpn_0001', 'cpn_0002', 'cpn_0003'])
    expect(body.coupons[0].codes.map((code: any) => code.code)).toEqual(['LAUNCH25'])
  })
})

describe('the Coupons list answers its panel and search over the whole set', () => {
  it('answers every clause, all at once', async () => {
    const body = await (
      await list({
        filters: JSON.stringify([
          { field: 'status', op: 'equals', value: 'valid' },
          { field: 'timesRedeemed', op: '>=', value: '1' },
        ]),
      })
    ).json()
    expect(body.rows.map((row: any) => row.id)).toEqual(['cpn_0001', 'cpn_0003'])
    expect(body.refused).toEqual([])
    expect(body.total).toBe(2)
  })

  it('searches a coupon’s name, its id and its promotion codes', async () => {
    const byCode = await (await list({ search: 'launch25' })).json()
    expect(byCode.rows.map((row: any) => row.id)).toEqual(['cpn_0001'])
    const byName = await (await list({ search: 'partner' })).json()
    expect(byName.rows.map((row: any) => row.id)).toEqual(['cpn_0002'])
    const byId = await (await list({ search: 'cpn_0003' })).json()
    expect(byId.rows.map((row: any) => row.id)).toEqual(['cpn_0003'])
  })

  it('pages the answer by the last coupon’s id', async () => {
    const first = await (await list({ pageSize: '2' })).json()
    expect(first.rows.map((row: any) => row.id)).toEqual(['cpn_0001', 'cpn_0002'])
    expect(first.hasMore).toBe(true)
    expect(first.nextCursor).toBe('cpn_0002')
    const second = await (await list({ pageSize: '2', cursor: first.nextCursor })).json()
    expect(second.rows.map((row: any) => row.id)).toEqual(['cpn_0003'])
    expect(second.hasMore).toBe(false)
  })

  it('refuses by name what it does not filter by, and applies none of it', async () => {
    const body = await (
      await list({
        filters: JSON.stringify([
          { field: 'discount', op: 'equals', value: '10' },
          { field: 'duration', op: 'startsWith', value: 'on' },
        ]),
      })
    ).json()
    expect(body.rows).toHaveLength(3)
    expect(body.refused.map((entry: any) => entry.clause.field)).toEqual(['discount', 'duration'])
  })

  it('refuses unreadable filters with a 400, never the whole list under them', async () => {
    expect((await list({ filters: '{not json' })).status).toBe(400)
  })

  it('is staff only', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
    expect((await list({})).status).toBe(403)
    expect(stripeCalls).toEqual([])
  })
})
