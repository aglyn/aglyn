/**
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

import { marketingFigureReaders, marketingOutcomeFigureReaders } from './marketing-figures'

/**
 * Campaign and A/B testing results as figure tables (AGL-2915): the sends of
 * the window through `campaignReport`, pooled across sends rather than an
 * average of rates, and each test's variants against the first.
 */

const NOW = new Date('2026-09-16T15:00:00.000Z')
const sentAt = (daysAgo: number) => ({ toMillis: () => Date.UTC(2026, 8, 16) - daysAgo * 86_400_000 + 3_600_000 })

/** Every collection a reader read, by full path. */
let reads: string[] = []

function firestoreOf(collections: Record<string, Array<{ id: string; data: Record<string, unknown>; stats?: Array<{ id: string; data: Record<string, unknown> }> }>>) {
  // Equality filters are honored, so a read that forgot to narrow to its site
  // is handed a sibling's documents here as it would be by Firestore.
  const collection = (path: string, where: Array<[string, unknown]> = []): any => ({
    where: (field: string, _op: string, value: unknown) => collection(path, [...where, [field, value]]),
    orderBy: () => collection(path, where),
    limit: () => collection(path, where),
    get: async () => {
      reads.push(path)
      const entries = collections[path.split('/').pop() as string] ?? []
      return {
        docs: entries
          .filter((entry) => where.every(([field, value]) => entry.data[field] === value))
          .map((entry) => ({
            id: entry.id,
            data: () => entry.data,
            ref: {
              collection: () => ({
                get: async () => ({ docs: (entry.stats ?? []).map((stat) => ({ id: stat.id, data: () => stat.data })) }),
              }),
            },
          })),
      }
    },
  })
  return {
    collection: (root: string) => ({
      doc: (id: string) => ({ collection: (name: string) => collection(`${root}/${id}/${name}`) }),
    }),
  } as unknown as FirebaseFirestore.Firestore
}

beforeEach(() => {
  reads = []
})

const readerFor = (id: string, firestore: FirebaseFirestore.Firestore) => {
  const reader = marketingFigureReaders(() => firestore).find((entry) => entry.id === id)
  if (!reader) throw new Error(id)
  return reader
}

describe('campaigns', () => {
  it('reads the sends of the window, pooling their rates on the first row', async () => {
    const firestore = firestoreOf({
      campaigns: [
        { id: 'c1', data: { hostId: 'host-1', subject: 'Fall sale', sentAt: sentAt(1), stats: { sent: 100, delivered: 100, uniqueOpens: 50, uniqueClicks: 10, htmlPart: true } } },
        { id: 'c2', data: { hostId: 'host-1', subject: 'New arrivals', sentAt: sentAt(3), stats: { sent: 300, delivered: 300, uniqueOpens: 60, uniqueClicks: 30, htmlPart: true } } },
        { id: 'c3', data: { hostId: 'host-1', subject: 'Old news', sentAt: sentAt(20), stats: { delivered: 50 } } },
        { id: 'c4', data: { hostId: 'host-1', subject: 'Draft' } },
        // The same org's other site, in the same window: not this site's figures.
        { id: 'c5', data: { hostId: 'host-2', subject: 'Their sale', sentAt: sentAt(1), stats: { sent: 999, delivered: 999 } } },
      ],
    })
    const read = await readerFor('marketing.campaigns', firestore).read({
      orgId: 'org-1',
      hostId: 'host-1',
      days: 7,
      now: NOW,
      uid: null,
      params: {},
    })
    if (read.ok === false) throw new Error(read.error)
    expect(reads).toEqual(['orgs/org-1/campaigns'])
    expect(read.table.rows.map((row) => [row['campaign'], row['delivered']])).toEqual([
      ['All campaigns', 400],
      ['Fall sale', 100],
      ['New arrivals', 300],
    ])
    const [all, fall, arrivals] = read.table.rows
    // Pooled: 110 of 400 opened, never the average of 50% and 20%.
    expect(all['openRate']).toBe(27.5)
    expect(fall['openRate']).toBe(50)
    expect(arrivals['openRate']).toBe(20)
  })
})

describe('A/B tests', () => {
  it('reads each running or finished test’s variants against the first', async () => {
    const firestore = firestoreOf({
      experiments: [
        {
          id: 'e1',
          data: { name: 'Hero headline', status: 'running', variants: [{ id: 'a', name: 'Control' }, { id: 'b', name: 'Shorter' }] },
          stats: [
            { id: 'a', data: { exposures: 1_000, conversions: 50 } },
            { id: 'b', data: { exposures: 1_000, conversions: 80 } },
          ],
        },
        { id: 'e2', data: { name: 'Draft test', status: 'draft', variants: [{ id: 'a' }, { id: 'b' }] } },
      ],
    })
    const read = await readerFor('marketing.experiments', firestore).read({
      orgId: 'org-1',
      hostId: 'host-1',
      days: 0,
      now: NOW,
      uid: null,
      params: {},
    })
    if (read.ok === false) throw new Error(read.error)
    // A/B tests stay the site's own.
    expect(reads[0]).toBe('hosts/host-1/experiments')
    expect(read.table.rows).toEqual([
      { test: 'Hero headline', variant: 'Control', shown: 1_000, conversions: 50, rate: 5, lift: null, confidence: null },
      { test: 'Hero headline', variant: 'Shorter', shown: 1_000, conversions: 80, rate: 8, lift: 60, confidence: expect.any(Number) },
    ])
    expect(Number(read.table.rows[1]['confidence'])).toBeGreaterThan(99)
  })
})

/**
 * What the campaigns caused and earned (AGL-3603): conversions counted by
 * aggregation over the window — never a record loaded — and revenue read from
 * each window send's rollup, with neither kinds nor currencies added together.
 */
describe('campaign conversions and revenue', () => {
  type Filter = [string, string, unknown]
  /** Every aggregation the conversions reader asked, as its filters. */
  let counted: Array<{ path: string; filters: Filter[] }> = []
  /** Every keyed read the revenue reader made. */
  let keyed: string[] = []

  const attributions: Array<Record<string, unknown>> = [
    { kind: 'form', channel: 'email', convertedAtMs: NOW.getTime() - 86_400_000 },
    { kind: 'form', channel: 'email', convertedAtMs: NOW.getTime() - 2 * 86_400_000 },
    { kind: 'form', channel: 'page', convertedAtMs: NOW.getTime() - 3 * 86_400_000 },
    { kind: 'lead', channel: 'web', convertedAtMs: NOW.getTime() - 86_400_000 },
    // Outside a 7-day window.
    { kind: 'form', channel: 'email', convertedAtMs: NOW.getTime() - 20 * 86_400_000 },
  ]

  function outcomesFirestore(sends: Array<{ id: string; data: Record<string, unknown>; revenue?: Record<string, unknown> }>) {
    const query = (path: string, filters: Filter[] = []): any => ({
      where: (field: string, op: string, value: unknown) => query(path, [...filters, [field, op, value]]),
      orderBy: () => query(path, filters),
      limit: () => query(path, filters),
      count: () => ({
        get: async () => {
          counted.push({ path, filters })
          const matches = attributions.filter((record) =>
            filters.every(([field, op, value]) => {
              const actual = record[field] as number
              if (op === '==') return actual === value
              if (op === '>=') return actual >= (value as number)
              if (op === '<') return actual < (value as number)
              return false
            }),
          )
          return { data: () => ({ count: matches.length }) }
        },
      }),
      get: async () => ({
        docs: sends
          .filter((send) => filters.every(([field, , value]) => send.data[field] === value))
          .map((send) => ({ id: send.id, data: () => send.data, get: (field: string) => send.data[field] })),
      }),
      doc: (id: string) => ({
        collection: (name: string) => ({ doc: (report: string) => ({ path: `${path}/${id}/${name}/${report}`, id }) }),
      }),
    })
    return {
      collection: (root: string) => ({
        doc: (id: string) => ({ collection: (name: string) => query(`${root}/${id}/${name}`) }),
      }),
      getAll: async (...refs: Array<{ path: string; id: string }>) =>
        refs.map((ref) => {
          keyed.push(ref.path)
          const send = sends.find((entry) => entry.id === ref.id)
          return { data: () => send?.revenue }
        }),
    } as unknown as FirebaseFirestore.Firestore
  }

  const outcomeReader = (id: string, firestore: FirebaseFirestore.Firestore) => {
    const reader = marketingOutcomeFigureReaders(() => firestore).find((entry) => entry.id === id)
    if (!reader) throw new Error(id)
    return reader
  }

  beforeEach(() => {
    counted = []
    keyed = []
  })

  it('counts each kind’s credited conversions in the window by channel, never adding the kinds', async () => {
    const read = await outcomeReader('marketing.conversions', outcomesFirestore([])).read({
      orgId: 'org-1',
      hostId: 'host-1',
      days: 7,
      now: NOW,
      uid: null,
      params: {},
    })
    if (read.ok === false) throw new Error(read.error)
    expect(read.table.rows).toEqual([
      { kind: 'Form submissions', credited: 3, email: 2, page: 1, web: 0, sequence: 0 },
      { kind: 'Leads', credited: 1, email: 0, page: 0, web: 1, sequence: 0 },
      { kind: 'Contacts', credited: 0, email: 0, page: 0, web: 0, sequence: 0 },
      { kind: 'Bookings', credited: 0, email: 0, page: 0, web: 0, sequence: 0 },
    ])
    // No total row and no total column: the kinds are different records of one visit.
    expect(read.table.rows.some((row) => /all|total/i.test(String(row['kind'])))).toBe(false)
    // The site's own records, by aggregation only — every count names a kind and the window.
    expect(new Set(counted.map((entry) => entry.path))).toEqual(new Set(['hosts/host-1/campaignAttributions']))
    expect(counted).toHaveLength(4 * 5)
    for (const { filters } of counted) {
      expect(filters[0]).toEqual(['kind', '==', expect.any(String)])
      expect(filters.map(([field, op]) => `${field}${op}`).slice(-2)).toEqual(['convertedAtMs>=', 'convertedAtMs<'])
    }
  })

  it('reads the revenue rollup of each email sent in the window, one row per currency', async () => {
    const firestore = outcomesFirestore([
      {
        id: 'c1',
        data: { hostId: 'host-1', subject: 'Fall sale', sentAt: sentAt(1) },
        revenue: { byCurrency: { usd: { grossCents: 12_000, refundedCents: 2_000, orders: 3 } } },
      },
      { id: 'c2', data: { hostId: 'host-1', subject: 'No sales', sentAt: sentAt(2) }, revenue: { byCurrency: {} } },
      // Sent before the window: its rollup is never read.
      { id: 'c3', data: { hostId: 'host-1', subject: 'Old', sentAt: sentAt(20) }, revenue: { byCurrency: { usd: { grossCents: 1, orders: 1 } } } },
    ])
    const read = await outcomeReader('marketing.revenue', firestore).read({
      orgId: 'org-1',
      hostId: 'host-1',
      days: 7,
      now: NOW,
      uid: null,
      params: {},
    })
    if (read.ok === false) throw new Error(read.error)
    expect(keyed).toEqual(['orgs/org-1/campaigns/c1/reports/revenue', 'orgs/org-1/campaigns/c2/reports/revenue'])
    expect(read.table.rows).toEqual([
      { campaign: 'Fall sale', currency: 'USD', orders: 3, gross: 120, refunded: 20, net: 100 },
    ])
    expect(read.table.columns.find((column) => column.key === 'net')).toMatchObject({ kind: 'money', currency: 'USD' })
  })

  it('never puts two currencies in one money column', async () => {
    const firestore = outcomesFirestore([
      {
        id: 'c1',
        data: { hostId: 'host-1', subject: 'Fall sale', sentAt: sentAt(1) },
        revenue: { byCurrency: { usd: { grossCents: 1_000, orders: 1 }, eur: { grossCents: 900, orders: 1 } } },
      },
    ])
    const read = await outcomeReader('marketing.revenue', firestore).read({
      orgId: 'org-1',
      hostId: 'host-1',
      days: 7,
      now: NOW,
      uid: null,
      params: {},
    })
    if (read.ok === false) throw new Error(read.error)
    expect(read.table.rows.map((row) => row['currency']).sort()).toEqual(['EUR', 'USD'])
    expect(read.table.columns.find((column) => column.key === 'net')?.kind).toBe('number')
  })

  it('refuses a window the readers do not cover, and a read with no site', async () => {
    const reader = outcomeReader('marketing.conversions', outcomesFirestore([]))
    const base = { orgId: 'org-1', now: NOW, uid: null, params: {} }
    expect((await reader.read({ ...base, hostId: 'host-1', days: 3 })).ok).toBe(false)
    expect((await reader.read({ ...base, hostId: null, days: 7 })).ok).toBe(false)
    expect(counted).toEqual([])
  })
})
