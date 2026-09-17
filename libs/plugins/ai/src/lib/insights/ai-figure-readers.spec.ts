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

import type { PluginFigureRead, PluginFigureReader, PluginFigureTable } from '@aglyn/aglyn/plugin-manager/plugin-figures'
import { AI_DATASET_MAX_GROUP_VALUES, AI_DATASET_MIN_GROUP, aiDatasetCatalog, aiFigureReaders } from './ai-figure-readers'

/**
 * The readers for the platform's own records (AGL-2915): what each table
 * holds, that it is aggregates and never a record, and that a dataset reads
 * only what the asking member may see, on the site's own terms.
 */

type Data = Record<string, unknown>

/** A Firestore that answers the reads these readers make, from a flat map of document paths. */
function firestoreOf(docs: Record<string, Data>) {
  const snapshot = (path: string) => {
    const data = docs[path]
    return {
      id: path.split('/').pop() as string,
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => data?.[field],
    }
  }
  const children = (path: string) =>
    Object.keys(docs)
      .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
      .sort()
  const collection = (path: string, cap = Infinity): any => ({
    doc: (id: string) => ({
      path: `${path}/${id}`,
      get: async () => snapshot(`${path}/${id}`),
      collection: (name: string) => collection(`${path}/${id}/${name}`),
    }),
    limit: (n: number) => collection(path, n),
    get: async () => ({ docs: children(path).slice(0, cap).map(snapshot) }),
    count: () => ({ get: async () => ({ data: () => ({ count: children(path).length }) }) }),
  })
  return {
    collection,
    getAll: async (...refs: Array<{ path: string }>) => refs.map((ref) => snapshot(ref.path)),
  } as unknown as FirebaseFirestore.Firestore
}

const NOW = new Date('2026-09-16T15:00:00.000Z')

const readerOf = (docs: Record<string, Data>, id: string): PluginFigureReader => {
  const reader = aiFigureReaders(() => firestoreOf(docs)).find((entry) => entry.id === id)
  if (!reader) throw new Error(`no reader ${id}`)
  return reader
}

async function tableOf(
  docs: Record<string, Data>,
  id: string,
  request: { hostId?: string | null; days?: number; uid?: string | null; params?: Record<string, string> } = {},
): Promise<PluginFigureTable> {
  const read: PluginFigureRead = await readerOf(docs, id).read({
    orgId: 'org-1',
    hostId: request.hostId === undefined ? 'host-1' : request.hostId,
    days: request.days ?? 7,
    now: NOW,
    uid: request.uid ?? null,
    params: request.params ?? {},
  })
  if (read.ok === false) throw new Error(read.error)
  return read.table
}

const day = (id: string, data: Data) => ({ [`hosts/host-1/analytics/${id}`]: data })

describe('traffic', () => {
  const docs = {
    // The window: Sep 10 to 16.
    ...day('2026-09-16', { total: 40, visitors: 20, paths: { '/pricing': 30, '/': 10 }, referrers: { 'google.com': 12 }, utm: { source: { newsletter: 5 } } }),
    ...day('2026-09-12', { total: 60, visitors: 25, paths: { '/pricing': 20, '/': 40 }, referrers: { 'google.com': 8, 'bing.com': 2 } }),
    // The week before: Sep 3 to 9.
    ...day('2026-09-05', { total: 80, visitors: 50, paths: { '/pricing': 10, '/': 70 } }),
  }

  it('sums the window and the one before it, with the Traffic card’s change', async () => {
    const table = await tableOf(docs, 'traffic.summary')
    expect(table.period).toEqual({ from: '2026-09-10', to: '2026-09-16', days: 7 })
    expect(table.rows).toEqual([
      { figure: 'Page views', current: 100, previous: 80, change: 25 },
      { figure: 'Visitors', current: 45, previous: 50, change: -10 },
      { figure: 'Page views a day', current: 14, previous: 11, change: 27.3 },
    ])
    expect(table.source).toEqual({ label: 'Analytics', path: 'analytics' })
  })

  it('reads no change where the window before recorded nothing, and says so', async () => {
    const table = await tableOf({ ...day('2026-09-16', { total: 5, visitors: 5 }) }, 'traffic.summary')
    expect(table.rows[0]).toEqual({ figure: 'Page views', current: 5, previous: 0, change: null })
    expect(table.notes.join(' ')).toMatch(/no change to compare/)
  })

  it('ranks pages by views with their share and change', async () => {
    const table = await tableOf(docs, 'traffic.pages')
    // Two pages with the same views are ranked by their path.
    expect(table.rows).toEqual([
      { page: '/', views: 50, share: 50, change: -28.6 },
      { page: '/pricing', views: 50, share: 50, change: 400 },
    ])
  })

  it('names where visits came from: referring sites and campaign tags', async () => {
    const table = await tableOf(docs, 'traffic.sources')
    expect(table.rows).toEqual([
      { source: 'google.com', type: 'Referring site', views: 20, share: 20 },
      { source: 'bing.com', type: 'Referring site', views: 2, share: 2 },
      { source: 'newsletter', type: 'Campaign source', views: 5, share: 5 },
    ])
  })

  it('lists each day of a short window, oldest first, and no longer one', async () => {
    const table = await tableOf(docs, 'traffic.daily')
    expect(table.rows.map((row) => row['day'])).toEqual([
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
    ])
    expect(table.rows[2]).toEqual({ day: '2026-09-12', views: 60, visitors: 25 })
    const refused = await readerOf(docs, 'traffic.daily').read({
      orgId: 'org-1',
      hostId: 'host-1',
      days: 30,
      now: NOW,
      uid: null,
      params: {},
    })
    expect(refused.ok).toBe(false)
  })
})

describe('forms', () => {
  it('reads each form’s counters over the months the window falls in, and leaves a deleted form out', async () => {
    const docs = {
      'hosts/host-1/forms/quote': {
        displayName: 'Quote request',
        stats: {
          views: 900,
          submissions: 90,
          periods: { '2026-08': { views: 500, submissions: 40 }, '2026-09': { views: 200, submissions: 30, leads: 12 } },
        },
      },
      'hosts/host-1/forms/news': { displayName: 'Newsletter', stats: { periods: { '2026-09': { views: 100, submissions: 5 } } } },
      'hosts/host-1/forms/old': { displayName: 'Old', deletedAt: 1, stats: { periods: { '2026-09': { submissions: 99 } } } },
    }
    const table = await tableOf(docs, 'forms.performance')
    expect(table.rows).toEqual([
      { form: 'Quote request', views: 200, submissions: 30, completion: 15, leads: 12 },
      { form: 'Newsletter', views: 100, submissions: 5, completion: 5, leads: null },
    ])
    expect(table.period).toEqual({ from: '2026-09-01', to: '2026-09-16', days: 16 })
  })
})

describe('datasets', () => {
  const records = (entries: Data[]) =>
    Object.fromEntries(entries.map((values, index) => [`orgs/org-1/datasets/orders/records/r${String(index).padStart(3, '0')}`, { values }]))
  const docs = {
    'orgs/org-1/members/owner': { role: 'owner' },
    'orgs/org-1/members/collab': { role: 'editor', allHosts: false, hostAccess: { 'host-2': 'editor' }, scopeTokens: ['org', 'host:host-2'] },
    'orgs/org-1/datasets/orders': {
      displayName: 'Wholesale orders',
      visibleTo: ['host:host-1'],
      model: {
        order: ['buyer', 'state', 'total'],
        fields: { buyer: { name: 'Buyer', type: 'text' }, state: { name: 'State', type: 'text' }, total: { name: 'Order total', type: 'float' } },
      },
    },
    'orgs/org-1/datasets/team': { displayName: 'Team', visibleTo: ['org'], model: { order: ['name'], fields: { name: { name: 'Name', type: 'text' } } } },
    ...records([
      { buyer: 'Avery', state: 'TX', total: 400 },
      { buyer: 'Blake', state: 'TX', total: 420 },
      { buyer: 'Casey', state: 'TX', total: 380 },
      { buyer: 'Devon', state: 'OK', total: 100 },
      { buyer: 'Emery', state: 'LA', total: 300 },
    ]),
  }

  it('lists what the member may see, and on a site only what is shared with it', async () => {
    const all = await tableOf(docs, 'datasets.summary', { hostId: null, uid: 'owner' })
    expect(all.rows).toEqual([
      { dataset: 'Team', records: 0, fields: 1 },
      { dataset: 'Wholesale orders', records: 5, fields: 3 },
    ])
    const onSite = await tableOf(docs, 'datasets.summary', { hostId: 'host-2', uid: 'collab' })
    expect(onSite.rows).toEqual([{ dataset: 'Team', records: 0, fields: 1 }])
    expect((await aiDatasetCatalog(firestoreOf(docs), { orgId: 'org-1', hostId: 'host-2', uid: 'collab' })).map((entry) => entry.name)).toEqual(['Team'])
  })

  it('summarizes a dataset’s fields without a single value of a text field', async () => {
    const table = await tableOf(docs, 'datasets.summary', { hostId: null, uid: 'owner', params: { dataset: 'Wholesale orders' } })
    expect(table.rows).toEqual([
      { field: 'Buyer', type: 'text', filled: 100, distinct: 5, lowest: null, average: null, highest: null },
      { field: 'State', type: 'text', filled: 100, distinct: 3, lowest: null, average: null, highest: null },
      { field: 'Order total', type: 'float', filled: 100, distinct: 5, lowest: 100, average: 320, highest: 420 },
    ])
    expect(JSON.stringify(table)).not.toContain('Avery')
  })

  it('groups records by a field, folding every group too small to be anyone but a person', async () => {
    const table = await tableOf(docs, 'datasets.breakdown', {
      hostId: null,
      uid: 'owner',
      params: { dataset: 'orders', group: 'state', measure: 'Order total', operation: 'average' },
    })
    expect(table.columns.map((column) => column.label)).toEqual(['State', 'Records', 'Average of Order total'])
    expect(table.rows).toEqual([
      { group: 'TX', records: 3, value: 400 },
      { group: `Other (2 groups under ${AI_DATASET_MIN_GROUP} records)`, records: 2, value: 200 },
    ])
    // Grouped by a field that names each buyer, nobody's name survives.
    const byBuyer = await tableOf(docs, 'datasets.breakdown', { hostId: null, uid: 'owner', params: { dataset: 'orders', group: 'buyer' } })
    expect(byBuyer.rows).toEqual([{ group: `Other (5 groups under ${AI_DATASET_MIN_GROUP} records)`, records: 5 }])
  })

  it('refuses a dataset the member may not read, a field it lacks, and a sum over text', async () => {
    const reader = readerOf(docs, 'datasets.breakdown')
    const ask = (uid: string, params: Record<string, string>) =>
      reader.read({ orgId: 'org-1', hostId: null, days: 0, now: NOW, uid, params })
    expect(await ask('collab', { dataset: 'orders', group: 'state' })).toMatchObject({ ok: false, status: 404 })
    expect(await ask('owner', { dataset: 'orders', group: 'region' })).toMatchObject({ ok: false, status: 400 })
    expect(await ask('owner', { dataset: 'orders', group: 'state', measure: 'buyer', operation: 'sum' })).toMatchObject({
      ok: false,
      status: 400,
    })
  })

  it('refuses to group by a field that tells records apart', async () => {
    const many = {
      ...docs,
      ...records(
        Array.from({ length: AI_DATASET_MAX_GROUP_VALUES + 1 }, (_, index) => ({
          buyer: `Buyer ${index}`,
          state: index % 2 ? 'TX' : 'OK',
          total: 10,
        })),
      ),
    }
    const reader = readerOf(many, 'datasets.breakdown')
    const ask = (params: Record<string, string>) =>
      reader.read({ orgId: 'org-1', hostId: null, days: 0, now: NOW, uid: 'owner', params })
    expect(await ask({ dataset: 'orders', group: 'buyer' })).toMatchObject({ ok: false, status: 400 })
    expect(await ask({ dataset: 'orders', group: 'state' })).toMatchObject({ ok: true })
  })
})
