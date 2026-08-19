/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
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
 * `GET /api/hosts/tax-summary` — a merchant's own storefront sales tax
 * (AGL-2440).
 *
 * TWO CONTRACTS ARE PINNED HERE, and they are the two ways this route could do
 * real harm.
 *
 * 1. THE TENANT BOUNDARY. `storefrontTaxCollected` spans every merchant and a
 *    row carries a shopper's address beside the amounts. Firestore rules deny
 *    the collection to every client, and rules do not apply to the Admin SDK —
 *    so the `hostId ==` filter in the query IS the boundary, and the
 *    membership check is what decides who may ask. The assertions below check
 *    the FILTER was applied, not merely that the response looked right: a
 *    route that read the whole collection and filtered afterwards would return
 *    identical JSON for this fixture while leaking every merchant's sales to
 *    the next reader who forgot the second step.
 *
 * 2. NO REMITTANCE DETERMINATION. Zach's 2026-08-19 decision is to ship the
 *    NUMBER and not the LABEL: the three buckets stay separate, nothing sums
 *    them, and no field says whose tax it is. `storefront-tax.ts` reserves
 *    marketplace-facilitator status to counsel, and a merged "tax collected"
 *    total would be that determination wearing a neutral name.
 *
 * The `@aglyn/aglyn/server` factory is a CLOSED WORLD — anything it does not
 * name is `undefined`, so the route would throw and every assertion below
 * would read a 500 as if the behaviour under test had regressed.
 */

const mockVerifyIdToken = jest.fn()
/** Every `where(...)` the route applied, in order, per collection. */
const mockFilters: Array<{ collection: string; field: string; op: string; value: unknown }> = []
const state: {
  hostExists: boolean
  memberRoles: Record<string, string>
  orgMemberExists: boolean
  rows: Array<Record<string, unknown>>
  undated: Array<Record<string, unknown>>
} = {
  hostExists: true,
  memberRoles: {},
  orgMemberExists: false,
  rows: [],
  undated: [],
}

const snapshotOf = (data: Record<string, unknown> | undefined) => ({
  exists: data !== undefined,
  data: () => data,
  get: (field: string) => (data ?? {})[field],
})

const docsOf = (rows: Array<Record<string, unknown>>) => ({
  size: rows.length,
  docs: rows.map((row, index) => ({
    id: String(row['id'] ?? `row-${index}`),
    data: () => row,
    get: (field: string) => row[field],
  })),
})

function taxQuery(collection: string) {
  const applied: Array<{ field: string; op: string; value: unknown }> = []
  const chain: any = {
    where: (field: string, op: string, value: unknown) => {
      applied.push({ field, op, value })
      mockFilters.push({ collection, field, op, value })
      return chain
    },
    limit: () => chain,
    get: async () => {
      // The double models the real semantics that matter here: a `paidAt ==
      // null` query and a `paidAt` RANGE query are different populations, and
      // null never matches a range. A fake that returned the same rows to both
      // would make the undated-row probe unassertable.
      const isNullProbe = applied.some(
        (filter) => filter.field === 'paidAt' && filter.op === '==',
      )
      // A host filter is mandatory in this route; if it is ever dropped, this
      // returns EVERY row and the leak assertion below fires.
      const hostFilter = applied.find((filter) => filter.field === 'hostId')
      const pool = isNullProbe ? state.undated : state.rows
      const rows = hostFilter
        ? pool.filter((row) => row['hostId'] === hostFilter.value)
        : pool
      return docsOf(rows)
    },
  }
  return chain
}

const fakeFirestore = {
  collection: (name: string) => {
    if (name === 'storefrontTaxCollected') return taxQuery(name)
    if (name === 'hosts') {
      return {
        doc: () => ({
          get: async () =>
            snapshotOf(
              state.hostExists
                ? { memberRoles: state.memberRoles, orgId: 'org-1' }
                : undefined,
            ),
        }),
      }
    }
    if (name === 'orgs') {
      return {
        doc: () => ({
          collection: () => ({
            doc: () => ({
              get: async () =>
                snapshotOf(state.orgMemberExists ? { role: 'admin' } : undefined),
            }),
          }),
        }),
      }
    }
    throw new Error(`unexpected collection ${name}`)
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => fakeFirestore,
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  getOrgForHost: async () => ({ orgId: 'org-1', org: {} }),
  resolveOrgIdForHost: async () => 'org-1',
  lockdownRefusal: async () => null,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: {
        authorization: request.headers.get('authorization') ?? undefined,
      },
    }
  },
}))

import { GET } from '../app/api/hosts/tax-summary/route'

const FROM = '2026-07-01T00:00:00.000Z'
const TO = '2026-08-01T00:00:00.000Z'

const get = (
  opts: { token?: string; hostId?: string; from?: string; to?: string } = {},
) => {
  const search = new URLSearchParams({
    hostId: opts.hostId ?? 'host-1',
    ...(opts.from === undefined ? { from: FROM } : opts.from ? { from: opts.from } : {}),
    ...(opts.to === undefined ? { to: TO } : opts.to ? { to: opts.to } : {}),
  })
  return GET(
    new Request(`https://app.aglyn.com/api/hosts/tax-summary?${search}`, {
      headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    }),
  )
}

/** One Stripe-Tax row on host-1, $100 base at 8.25% — the measured fixture. */
const AGLYN_ROW = {
  id: 'cs_aglyn',
  hostId: 'host-1',
  taxMode: 'stripe-automatic',
  taxLiability: 'platform',
  grossCents: 10825,
  taxCents: 825,
  currency: 'usd',
  customerAddress: { country: 'US', state: 'TX' },
  taxLines: [{ amountCents: 825, taxableAmountCents: 10000, jurisdiction: 'Texas' }],
  paidAt: new Date('2026-07-10T00:00:00.000Z'),
}

/** One manual-mode row on host-1 — the merchant's own configured rate. */
const MANUAL_ROW = {
  id: 'cs_manual',
  hostId: 'host-1',
  taxMode: 'manual',
  taxLiability: null,
  grossCents: 5500,
  taxCents: 500,
  currency: 'usd',
  customerAddress: { country: 'US', state: 'TX' },
  taxLines: [],
  paidAt: new Date('2026-07-11T00:00:00.000Z'),
}

/** The SAME period, a DIFFERENT merchant. Must never appear in the answer. */
const OTHER_MERCHANT_ROW = {
  ...AGLYN_ROW,
  id: 'cs_other',
  hostId: 'host-2',
  taxCents: 99_999,
  grossCents: 999_999,
}

const authorize = () =>
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })

beforeEach(() => {
  jest.clearAllMocks()
  mockFilters.length = 0
  state.hostExists = true
  state.memberRoles = { 'user-1': 'admin' }
  state.orgMemberExists = false
  state.rows = [AGLYN_ROW, MANUAL_ROW, OTHER_MERCHANT_ROW]
  state.undated = []
})

describe('/api/hosts/tax-summary reach (AGL-2440)', () => {
  it('401s an unauthenticated caller', async () => {
    expect((await get()).status).toBe(401)
    expect(mockFilters).toHaveLength(0)
  })

  it('400s a missing hostId rather than reading the whole collection', async () => {
    authorize()
    const response = await GET(
      new Request('https://app.aglyn.com/api/hosts/tax-summary', {
        headers: { authorization: 'Bearer tok' },
      }),
    )
    expect(response.status).toBe(400)
    expect(mockFilters).toHaveLength(0)
  })

  it('404s a caller who is neither a host member nor an org member', async () => {
    authorize()
    state.memberRoles = {}
    state.orgMemberExists = false
    const response = await get({ token: 'tok' })
    // 404, not 403: the route must not confirm the site exists.
    expect(response.status).toBe(404)
    expect(mockFilters).toHaveLength(0)
  })

  it('GUARD IS LIVE: the same caller is served once they are an ORG member', async () => {
    // Without this the 404 above could be a gate that refuses everybody, and
    // the workspace admins who own billing — who are frequently not members of
    // the site — are exactly who this report is for.
    authorize()
    state.memberRoles = {}
    state.orgMemberExists = true
    expect((await get({ token: 'tok' })).status).toBe(200)
  })

  it('serves a host member', async () => {
    authorize()
    expect((await get({ token: 'tok' })).status).toBe(200)
  })

  it('400s a malformed period instead of silently substituting the default', async () => {
    // A merchant who asked for Q1 and received the current month would file
    // the wrong number with no way to notice.
    //
    // `to` is far in the future ON PURPOSE. With a nearby `to`, a route that
    // silently defaulted the bad `from` to the current month would produce
    // `end <= start` and 400 anyway — the test would pass while the behaviour
    // it names was gone. This window stays valid under the defaulting bug, so
    // only the explicit refusal can make it 400.
    authorize()
    const response = await get({
      token: 'tok',
      from: 'not-a-date',
      to: '2099-01-01T00:00:00.000Z',
    })
    expect(response.status).toBe(400)
    expect(mockFilters).toHaveLength(0)
  })

  it('400s a period that ends before it starts', async () => {
    authorize()
    expect(
      (await get({ token: 'tok', from: TO, to: FROM })).status,
    ).toBe(400)
  })
})

describe('THE TENANT BOUNDARY is the hostId filter (AGL-2440)', () => {
  it('filters the query by hostId — not the response afterwards', async () => {
    authorize()
    await get({ token: 'tok' })
    const taxFilters = mockFilters.filter(
      (filter) => filter.collection === 'storefrontTaxCollected',
    )
    // BOTH queries — the period read and the undated probe — carry it.
    const hostFilters = taxFilters.filter((filter) => filter.field === 'hostId')
    expect(hostFilters).toHaveLength(2)
    for (const filter of hostFilters) {
      expect(filter.op).toBe('==')
      expect(filter.value).toBe('host-1')
    }
  })

  it('never returns another merchant’s sales', async () => {
    authorize()
    const body = await (await get({ token: 'tok' })).json()
    // host-2's row is 10× everything here; if the filter were dropped it would
    // dominate every figure below.
    expect(body.summary.aglynLiable.taxCollectedCents).toBe(825)
    expect(body.summary.aglynLiable.grossCents).toBe(10825)
    expect(body.summary.transactionCount).toBe(2)
  })

  it('applies the period as a RANGE, so a null paidAt cannot be swept in', async () => {
    authorize()
    await get({ token: 'tok' })
    const ops = mockFilters
      .filter(
        (filter) =>
          filter.collection === 'storefrontTaxCollected' &&
          filter.field === 'paidAt',
      )
      .map((filter) => filter.op)
      .sort()
    expect(ops).toEqual(['<', '==', '>='])
  })
})

describe('the buckets stay SEPARATE — no remittance determination (AGL-2440)', () => {
  it('reports the two modes as different facts and never sums them', async () => {
    authorize()
    const body = await (await get({ token: 'tok' })).json()
    expect(body.summary.aglynLiable.taxCollectedCents).toBe(825)
    expect(body.summary.merchantManual.taxCollectedCents).toBe(500)
    expect(body.summary.connectedAccountLiable.taxCollectedCents).toBe(0)
  })

  it('exposes NO merged total and NO field naming who remits', async () => {
    // The assertion that fails the day somebody adds a convenience total or a
    // `yoursToRemit` flag. Both are the banned legal characterisation — one
    // openly, one wearing a neutral name.
    authorize()
    const body = await (await get({ token: 'tok' })).json()
    const serialized = JSON.stringify(body)
    for (const banned of [
      'yoursToRemit',
      'merchantOwes',
      'totalTaxCollectedCents',
      'remittanceOwner',
      'facilitator',
    ]) {
      expect(`${banned}: ${serialized.includes(banned) ? 'PRESENT' : 'absent'}`).toBe(
        `${banned}: absent`,
      )
    }
    // …and no key anywhere is a sum across the three buckets.
    const total =
      body.summary.aglynLiable.taxCollectedCents +
      body.summary.merchantManual.taxCollectedCents +
      body.summary.connectedAccountLiable.taxCollectedCents
    expect(total).toBe(1325)
    expect(serialized).not.toContain('1325')
  })

  it('excludes an unrecognised taxMode rather than guessing a bucket', async () => {
    authorize()
    state.rows = [
      AGLYN_ROW,
      { ...MANUAL_ROW, id: 'cs_weird', taxMode: 'something-new' },
    ]
    const body = await (await get({ token: 'tok' })).json()
    expect(body.summary.attention.rowsUnclassified).toBe(1)
    expect(body.summary.transactionCount).toBe(1)
    expect(body.summary.merchantManual.taxCollectedCents).toBe(0)
  })

  it('counts a missing taxable base out loud instead of treating it as zero', async () => {
    authorize()
    state.rows = [{ ...AGLYN_ROW, taxLines: [{ amountCents: 825, taxableAmountCents: null }] }]
    const body = await (await get({ token: 'tok' })).json()
    expect(body.summary.attention.rowsMissingTaxableBase).toBe(1)
    // The tax is still counted; only the base is unknown.
    expect(body.summary.aglynLiable.taxCollectedCents).toBe(825)
    expect(body.summary.aglynLiable.taxableSalesCents).toBe(0)
  })

  it('reports undated rows, which no range query can see', async () => {
    authorize()
    state.undated = [{ ...AGLYN_ROW, id: 'cs_undated', paidAt: null }]
    const body = await (await get({ token: 'tok' })).json()
    expect(body.undatedRows).toBe(1)
    // …and it is NOT silently added to the period's figures.
    expect(body.summary.aglynLiable.transactionCount).toBe(1)
  })

  it('states the refund caveat in the payload, not only in the UI', async () => {
    // The figure over-states whenever a merchant has refunded. A caveat that
    // lives only in card copy is one refactor away from being dropped.
    authorize()
    const body = await (await get({ token: 'tok' })).json()
    expect(body.caveats.refundsNotReflected).toBe(true)
  })
})
