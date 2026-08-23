/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom, where `Request` is not a
 * constructor (feedback_jest_environment_pragma_shadowed_by_license).
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
 * `/api/admin/revenue` — the sweeps, and what the route says when a figure is
 * not a total (AGL-2486).
 *
 * Three defects are pinned here, all of which made the page report a
 * confident number it had not measured:
 *
 * 1. **A failed query was reported as a row cap.** The orders sweep passed
 *    `ordersInPeriod === null || overCap` as its `truncated` flag, so a query
 *    that returned NOTHING raised "the sweep hit its row cap" beside the real
 *    "the query failed" banner. Two banners, one cause, and the louder of the
 *    two sent the reader to narrow the period — which would never have helped.
 *
 * 2. **A flat `limit()` silently clipped the answer.** Past 2000 invoices (or
 *    1000 orders) the total simply stopped counting, and the page said only
 *    that "at least one total" was incomplete without naming which.
 *
 * 3. **A period before the mirror existed reported $0.** `platformRevenue`
 *    began with AGL-1811; every earlier invoice is unrecorded. The period
 *    dropdown offers those months anyway, so the page answered "zero" to a
 *    question it could not answer at all.
 *
 * The Firestore double honours `limit`, `startAfter` and the range filters,
 * because a double that ignored them would make the paging untestable and
 * would bless a route that read one page and called it a total.
 */

export {}

const mockVerifyIdToken = jest.fn()

/** Documents by source key, or an Error the query must reject with. */
let mockSources: Record<string, Array<Record<string, unknown>> | Error> = {}
/** Every `where` the route issued, by source — so a field can be asserted. */
let mockFilters: Record<string, Array<[string, string, unknown]>> = {}
/** Every document id fetched via `getAll`, so the read BUDGET is assertable. */
let mockGetAllIds: string[] = []

function mockDoc(data: Record<string, unknown>, index: number) {
  const id = String(data['$id'] ?? `doc-${index}`)
  return {
    id,
    exists: true,
    ref: {
      id,
      // The revenue route reaches `org.ref.collection('usage').doc(month)`
      // for the unbilled-meter read, so an org document has to carry it.
      collection: () => ({ doc: () => ({ id: `${id}/usage` }) }),
      parent: { parent: { id: String(data['$parentId'] ?? id) } },
    },
    data: () => data,
    get: (field: string) => data[field],
  }
}

/**
 * A chainable query double that actually applies what it is told.
 *
 * Range filters, ordering, `startAfter` and `limit` are all honoured, so
 * `sweepAll`'s cursor loop runs for real: a double that returned the whole
 * list on every page would spin forever or, worse, make a one-page read look
 * like an exhaustive sweep.
 */
interface MockQueryState {
  filters: Array<[string, string, unknown]>
  orderField: string | null
  limitCount: number | null
  after: unknown
}

function mockQuery(
  key: string,
  state: MockQueryState = {
    filters: [],
    orderField: null,
    limitCount: null,
    after: null,
  },
): any {
  const { filters, orderField, limitCount, after } = state
  // IMMUTABLE, like a real Firestore query: every builder call returns a NEW
  // query rather than mutating this one. The route derives three different
  // queries from the same `collection('platformRevenue')` handle — the period
  // sweep, the undated count and the earliest-invoice probe — and a mutating
  // double let those three collide, so `limit(1)` from the last one silently
  // clipped the first one's paging.
  const query: any = {
    where(field: string, op: string, value: unknown) {
      mockFilters[key] = [...(mockFilters[key] ?? []), [field, op, value]]
      return mockQuery(key, {
        ...state,
        filters: [...filters, [field, op, value]],
      })
    },
    orderBy(field: string) {
      return mockQuery(key, { ...state, orderField: field })
    },
    limit(count: number) {
      return mockQuery(key, { ...state, limitCount: count })
    },
    startAfter(doc: unknown) {
      return mockQuery(key, { ...state, after: doc })
    },
    doc(id: string) {
      return { id, __collection: key }
    },
    async get() {
      const source = mockSources[key]
      if (source instanceof Error) throw source
      let rows = [...(source ?? [])]
      for (const [field, op, value] of filters) {
        rows = rows.filter((row) => {
          const actual = row[field]
          if (op === '>=') return Number(actual) >= Number(value)
          if (op === '<') return Number(actual) < Number(value)
          if (op === '==') return (actual ?? null) === value
          return true
        })
      }
      if (orderField === '__name__') {
        rows.sort((a, b) => String(a['$id']).localeCompare(String(b['$id'])))
      } else if (orderField) {
        rows.sort((a, b) => Number(a[orderField]) - Number(b[orderField]))
      }
      let docs = rows.map(mockDoc)
      if (after) {
        const index = docs.findIndex((doc) => doc.id === (after as any).id)
        docs = index >= 0 ? docs.slice(index + 1) : docs
      }
      if (limitCount !== null) docs = docs.slice(0, limitCount)
      return { size: docs.length, empty: docs.length === 0, docs }
    },
  }
  return query
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    // The contracted sweeps order by document id, so the double needs the
    // same `FieldPath` handle the route reaches for.
    firestore: { FieldPath: { documentId: () => '__name__' } },
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        // `orgs` is a PAGED sweep now, so the double must serve it through
        // the same query builder as everything else — a bespoke `.get()`
        // shortcut here would have let the unbounded read survive the test.
        collection: (name: string) => mockQuery(name),
        collectionGroup: (name: string) => mockQuery(name),
        getAll: async (...refs: any[]) => {
          mockGetAllIds.push(...refs.map((ref) => String(ref?.id ?? '')))
          return refs.map((ref) => {
            const source = mockSources[String(ref?.__collection ?? '')]
            const rows = Array.isArray(source) ? source : []
            const data = rows.find((row) => String(row['$id']) === ref?.id)
            return {
              id: ref?.id,
              exists: Boolean(data),
              data: () => data,
              get: (field: string) => (data as any)?.[field],
            }
          })
        },
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

jest.mock('@aglyn/aglyn/server', () => {
  const actual = jest.requireActual('@aglyn/aglyn/server')
  return {
    __esModule: true,
    ...actual,
    pluginRequestFromWeb: async (request: Request) => ({
      method: request.method,
      query: {},
      body: undefined,
      headers: {
        authorization: request.headers.get('authorization') ?? undefined,
        origin: 'https://app.aglyn.com',
        host: 'app.aglyn.com',
      },
    }),
  }
})

import { GET, SWEEP_CEILING } from '../app/api/admin/revenue/route'

const AUGUST_START = Date.UTC(2026, 7, 1)

/**
 * A Firestore Timestamp as far as both readers care: `toDate()` for the route
 * and `valueOf()` so the double's range filter can compare it numerically.
 * Storing a bare number instead would make the coverage probe read `null` and
 * the whole mirror look empty — a fake red that hides a real behaviour.
 */
function timestamp(ms: number) {
  return { toDate: () => new Date(ms), valueOf: () => ms }
}

/** A paid invoice row as `platformRevenue` stores it. */
function invoice(index: number, grossCents = 100) {
  return {
    $id: `in_${index}`,
    grossCents,
    taxCents: 0,
    paidAt: timestamp(AUGUST_START + index * 1000),
  }
}

async function call(period = '2026-08'): Promise<any> {
  const response = await GET(
    new Request(`https://app.aglyn.com/api/admin/revenue?period=${period}`, {
      method: 'GET',
      headers: { authorization: 'Bearer staff-token' },
    }),
  )
  return response.json()
}

beforeEach(() => {
  mockSources = { orgs: [], billing: [], platformRevenue: [] }
  mockFilters = {}
  mockGetAllIds = []
  mockVerifyIdToken.mockReset()
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email_verified: true,
    staff: true,
  })
})

describe('a query that failed is never reported as a row cap', () => {
  it('raises the failure flag and NOT truncation when the orders sweep throws', async () => {
    mockSources['orders'] = Object.assign(
      new Error('9 FAILED_PRECONDITION: The query requires an index'),
      { code: 9 },
    )
    const body = await call()

    expect(body.commerceQueryFailed).toBe(true)
    // The whole point: the failure must not masquerade as a cap.
    expect(body.attention.commerceTruncated).toBe(false)
    expect(body.subscriptionsTruncated).toBe(false)
    expect(body.marketplaceTruncated).toBe(false)
    expect(body.truncatedSources).toEqual([])
  })

  it('still reports the OTHER sources when the orders sweep throws', async () => {
    mockSources['orders'] = new Error('boom')
    mockSources['platformRevenue'] = [invoice(1, 2500)]
    const body = await call()

    // A commerce failure degrading to "commerce not counted" must not take
    // the subscription figure down with it.
    expect(body.settled.subscriptions.netOfReversalsCents).toBe(2500)
    expect(body.settled.commerce.commissionNetCents).toBe(0)
  })
})

describe('the storefront sweep reads the field the index covers', () => {
  it('ranges orders on createdAtMs, never on the createdAt timestamp', async () => {
    mockSources['orders'] = []
    await call()

    const fields = (mockFilters['orders'] ?? []).map(([field]) => field)
    expect(fields.length).toBeGreaterThan(0)
    expect(new Set(fields)).toEqual(new Set(['createdAtMs']))
    expect(fields).not.toContain('createdAt')
  })

  it('ranges marketplace on createdAt — a top-level collection, not a group', async () => {
    // The mirror image, and it earns its place: while fixing the orders
    // query I crossed the two and pointed MARKETPLACE at `createdAtMs`, a
    // field `marketplacePurchases` does not carry. The collection-group
    // index guard cannot see that one — marketplace is not a collection
    // group — so nothing but this would have caught it.
    mockSources['marketplacePurchases'] = []
    await call()

    const fields = (mockFilters['marketplacePurchases'] ?? []).map(
      ([field]) => field,
    )
    expect(fields.length).toBeGreaterThan(0)
    expect(new Set(fields)).toEqual(new Set(['createdAt']))
  })

  it('counts an order that only a createdAtMs range can find', async () => {
    // Carries BOTH fields, exactly as `draft-order.ts` writes them. A route
    // ranging `createdAt` would filter this out of the double as a non-number
    // and report $0 — which is precisely what production did.
    mockSources['orders'] = [
      {
        $id: 'order-1',
        createdAtMs: AUGUST_START + 60_000,
        createdAt: { seconds: 1 },
        amountCents: 10_000,
        // Comfortably above the processing pass-through the fold subtracts,
        // so the take is non-zero for a reason the fixture states rather than
        // by luck: a fee at or below the pass-through nets to $0 legitimately.
        feeCents: 1_000,
      },
    ]
    const body = await call()
    expect(body.settled.commerce.transactionCount).toBe(1)
    expect(body.settled.commerce.commissionNetCents).toBeGreaterThan(0)
  })
})

describe('the sweep pages instead of clipping at a row cap', () => {
  it('folds every invoice past the old 2000-row limit', async () => {
    const rows = Array.from({ length: 2500 }, (_, index) =>
      invoice(index, 100),
    )
    mockSources['platformRevenue'] = rows
    const body = await call()

    // The old shape answered 2000 rows and `truncated: true`. Asserted as a
    // measured total rather than a constant: every row is 100 cents.
    expect(body.settled.subscriptions.transactionCount).toBe(rows.length)
    expect(body.settled.subscriptions.grossCents).toBe(rows.length * 100)
    expect(body.subscriptionsTruncated).toBe(false)
    expect(body.truncatedSources).toEqual([])
  })

  it('names the source when the safety ceiling really is reached', async () => {
    // Proves the ceiling is WIRED. Without this, `truncated` could be
    // hard-wired to `false` and every assertion above would still pass — the
    // page would then have no way left to admit an incomplete total.
    mockSources['platformRevenue'] = Array.from(
      { length: SWEEP_CEILING + 1 },
      (_, index) => invoice(index, 100),
    )
    const body = await call()

    expect(body.subscriptionsTruncated).toBe(true)
    expect(body.truncatedSources).toEqual(['subscriptions'])
    // The other sources are whole, and the response says so per source rather
    // than condemning the whole page as "at least one total".
    expect(body.marketplaceTruncated).toBe(false)
    expect(body.attention.commerceTruncated).toBe(false)
  })
})

describe('a period the settled mirror cannot answer says so', () => {
  it('flags a period that starts before the earliest recorded invoice', async () => {
    // The real shape of the bug: the only mirrored invoice is from August,
    // and July is asked about. July settled figures are unanswerable.
    mockSources['platformRevenue'] = [invoice(1, 2500)]
    const body = await call('2026-07')

    expect(body.periodPrecedesCoverage).toBe(true)
    expect(body.settledMirrorEmpty).toBe(false)
    expect(body.settledCoverageStart).toBe(
      new Date(AUGUST_START + 1000).toISOString(),
    )
  })

  it('does NOT flag a period that begins after the mirror started', async () => {
    // The negative control. Without it, a flag hard-wired to `true` would
    // pass the assertion above while meaning nothing.
    //
    // The earliest record predates the whole period, so nothing at the start
    // of August is missing. Note the flag is deliberately sensitive to a
    // PARTIAL hole: a mirror that began mid-August really does make the
    // August total a lower bound, and the page should say so rather than
    // wait for a month that is wholly uncovered.
    mockSources['platformRevenue'] = [
      { ...invoice(1, 2500), paidAt: timestamp(Date.UTC(2026, 6, 4)) },
    ]
    const body = await call('2026-08')
    expect(body.periodPrecedesCoverage).toBe(false)
    expect(body.settledMirrorEmpty).toBe(false)
  })

  it('says the mirror is empty rather than reporting a measured zero', async () => {
    mockSources['platformRevenue'] = []
    const body = await call()
    expect(body.settledMirrorEmpty).toBe(true)
    expect(body.settledCoverageStart).toBeNull()
  })
})

describe('attribution is bounded, and keyed on the right dimension', () => {
  it('attributes a storefront order to the host in its PATH', async () => {
    mockSources['orders'] = [
      {
        $id: 'order-1',
        $parentId: 'host-a',
        createdAtMs: AUGUST_START + 60_000,
        amountCents: 20_000,
        feeCents: 2_000,
      },
    ]
    mockSources['hosts'] = [
      { $id: 'host-a', displayName: 'Northwind Coffee', subdomain: 'northwind' },
    ]
    const body = await call()

    const rows = body.attributionByHost.rows
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe('host-a')
    // Decorated from the hosts collection, not left as a raw id.
    expect(rows[0].name).toBe('Northwind Coffee')
    // And it reconciles to the storefront line above it.
    expect(rows[0].gainCents).toBe(body.settled.commerce.commissionNetCents)
  })

  it('reads names for the rows it will SHOW, not for every row it folded', async () => {
    // The read-budget guard. Attributing by listing means touching a
    // collection this page did not previously read, and the lookup has to be
    // bounded by the display cap or it is an unbounded read arriving from a
    // new direction.
    mockSources['marketplacePurchases'] = Array.from(
      { length: 260 },
      (_, index) => ({
        $id: `cs_${index}`,
        listingId: `listing-${index}`,
        sellerOrgId: 'pub-1',
        createdAt: AUGUST_START + index,
        amountCents: 10_000,
        feeCents: 1_500,
      }),
    )
    const body = await call()

    const listingLookups = mockGetAllIds.filter((id) =>
      id.startsWith('listing-'),
    )
    expect(body.attributionByListing.rows).toHaveLength(100)
    expect(listingLookups).toHaveLength(100)
    // 260 sales folded, 100 names read — the budget follows the table, not
    // the data.
    expect(body.settled.marketplace.transactionCount).toBe(260)
    // And the remainder is carried as figures so the table still adds up.
    const shown = body.attributionByListing.rows.reduce(
      (sum: number, row: any) => sum + row.gainCents,
      0,
    )
    expect(shown + body.attributionByListing.omittedGainCents).toBe(
      body.settled.marketplace.commissionNetCents,
    )
  })

  it('names a deleted entity rather than rendering a blank cell', async () => {
    mockSources['orders'] = [
      {
        $id: 'order-1',
        $parentId: 'host-gone',
        createdAtMs: AUGUST_START + 1,
        amountCents: 20_000,
        feeCents: 2_000,
      },
    ]
    mockSources['hosts'] = []
    const body = await call()
    expect(body.attributionByHost.rows[0].name).toBe('host-gone (deleted)')
  })
})
