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
import {
  DATASET_FIGURE_MAX_GROUP_VALUES,
  DATASET_FIGURE_MIN_GROUP,
  datasetFigureReaders,
} from './dataset-figures'

/**
 * The dataset figures an insight reads (AGL-2915): that each table is
 * aggregates and never a record, and that a dataset reads only what the asking
 * member may see, on the site's own terms. Registered by the data plugin, which
 * keeps the datasets (AGL-3080).
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
  const reader = datasetFigureReaders(() => firestoreOf(docs)).find((entry) => entry.id === id)
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
      { group: `Other (2 groups under ${DATASET_FIGURE_MIN_GROUP} records)`, records: 2, value: 200 },
    ])
    // Grouped by a field that names each buyer, nobody's name survives.
    const byBuyer = await tableOf(docs, 'datasets.breakdown', { hostId: null, uid: 'owner', params: { dataset: 'orders', group: 'buyer' } })
    expect(byBuyer.rows).toEqual([{ group: `Other (5 groups under ${DATASET_FIGURE_MIN_GROUP} records)`, records: 5 }])
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
        Array.from({ length: DATASET_FIGURE_MAX_GROUP_VALUES + 1 }, (_, index) => ({
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
