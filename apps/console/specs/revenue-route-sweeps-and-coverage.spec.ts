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

// The route awaits the plugin surface before it asks the revenue sources.
// Nothing is loaded here: a case that needs a source registers its own, and a
// declared source nobody registered is refused.
jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: { ensureAll: async () => undefined },
}))

import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  registerRevenueSource,
  type RevenueSourceAnswer,
  type RevenueSourceRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-revenue-sources'
import { GET, SWEEP_CEILING } from '../app/api/admin/revenue/route'

/** A stand-in source: the plugins' own reads are proved in each plugin. */
function standIn(
  read: (request: RevenueSourceRequest) => Promise<Partial<RevenueSourceAnswer>>,
  pluginId = 'commerce',
) {
  registerRevenueSource(
    {
      read: async (request) => ({
        id: pluginId,
        name: `${pluginId} sales`,
        earned: { label: `${pluginId} commission`, cents: 0, note: '' },
        grossToNet: [],
        notes: [],
        attribution: [],
        truncated: false,
        failure: null,
        summary: {},
        ...(await read(request)),
      }),
    },
    { pluginId },
  )
}

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
  resetPluginServicesForTests()
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

describe('a source that could not be read is named, never read as zero', () => {
  it('REFUSES every declared source that registered nothing', async () => {
    mockSources['platformRevenue'] = [invoice(1, 2500)]
    const body = await call()
    expect(body.sources.map((section: any) => [section.pluginId, section.outcome])).toEqual([
      ['commerce', 'refused'],
      ['marketplace', 'refused'],
    ])
    // A refusal is not a cap, and it does not take the subscription figure
    // down with it.
    expect(body.truncatedSources).toEqual([])
    expect(body.settled.subscriptions.netOfReversalsCents).toBe(2500)
    expect(body.settled.totalEarnedCents).toBe(2500)
  })

  it('adds an answered source’s earnings to the total, and a failed one’s not at all', async () => {
    mockSources['platformRevenue'] = [invoice(1, 2500)]
    standIn(async () => ({ earned: { label: 'Storefront commission', cents: 700, note: '' } }))
    standIn(async () => {
      throw new Error('boom')
    }, 'marketplace')
    const body = await call()
    expect(body.settled.totalEarnedCents).toBe(2500 + 700)
    expect(body.sources[1]).toMatchObject({ outcome: 'refused', pluginId: 'marketplace' })
  })

  it('names a source whose sweep stopped at the ceiling, by its own name', async () => {
    standIn(async () => ({ truncated: true }))
    const body = await call()
    expect(body.truncatedSources).toEqual(['commerce sales'])
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
    // The other sources are whole, and the response says so per source rather
    // than condemning the whole page as "at least one total".
    expect(body.truncatedSources).toEqual(['subscriptions'])
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

describe('what the report lends a source: its sweep, its names and its budget', () => {
  it('pages a source’s query under the SAME ceiling, and says when it stopped', async () => {
    mockSources['orders'] = Array.from({ length: 1200 }, (_, index) => ({
      $id: `order-${index}`,
      createdAtMs: AUGUST_START + index,
    }))
    let swept: { docs: unknown[]; truncated: boolean } | null = null
    standIn(async (request) => {
      swept = await request.sweep(
        mockQuery('orders').where('createdAtMs', '>=', 0),
        'createdAtMs',
      )
      return {}
    })
    await call()
    // Past the 500-row page, folded whole — the sweep pages, never clips.
    expect(swept?.docs).toHaveLength(1200)
    expect(swept?.truncated).toBe(false)
  })

  it('names only the rows a source hands it, and says a deleted one is gone', async () => {
    mockSources['hosts'] = [
      { $id: 'host-a', displayName: 'Northwind Coffee', subdomain: 'northwind' },
    ]
    const rows = [
      { key: 'host-a', name: 'host-a', detail: '', gainCents: 1, lossCents: 0, count: 1 },
      { key: 'host-gone', name: 'host-gone', detail: '', gainCents: 1, lossCents: 0, count: 1 },
      // The unattributed row is a label, not an id, and is never looked up.
      { key: 'Host not recorded', name: 'Host not recorded', detail: '', gainCents: 1, lossCents: 0, count: 1 },
    ]
    standIn(async (request) => {
      await request.nameRows(rows, {
        collection: 'hosts',
        nameField: 'displayName',
        detailField: 'subdomain',
      })
      return {}
    })
    await call()
    expect(mockGetAllIds.filter((id) => id.startsWith('host'))).toEqual(['host-a', 'host-gone'])
    expect(rows.map((row) => [row.name, row.detail])).toEqual([
      ['Northwind Coffee', 'northwind'],
      ['host-gone (deleted)', ''],
      ['Host not recorded', ''],
    ])
  })

  it('names an organization from the org sweep it already read — no read', async () => {
    mockSources['orgs'] = [{ $id: 'pub-1', name: 'Acme Plugins' }]
    let names: ReadonlyMap<string, string> = new Map()
    standIn(async (request) => {
      names = await request.orgNames(['pub-1', 'pub-unknown'])
      return {}
    })
    await call()
    expect([...names]).toEqual([['pub-1', 'Acme Plugins']])
    // The only read of that org is its usage rollup, which the report makes
    // for its own reasons; its name cost nothing.
    expect(mockGetAllIds).not.toContain('pub-1')
  })
})
