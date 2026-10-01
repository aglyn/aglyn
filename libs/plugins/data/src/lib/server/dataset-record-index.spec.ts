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
 * @jest-environment node
 */

/**
 * The data plugin's `dataset` index (AGL-3080): what another surface — an AI
 * job, a planner — reads of the workspace's datasets. Live datasets only, a
 * site's answer narrowed to the ones shared with it, each with its fields in
 * the dataset page's order and its scope tokens, never a record; and a
 * `truncated` that is a fact rather than a guess.
 */

type Doc = Record<string, unknown>
let mockDocs: Record<string, Doc> = {}

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  // The org-scoped query narrowed to what the site may see, as the real one
  // asks Firestore to.
  scopedToHost: (ref: { narrowTo: (hostId: string) => unknown }, hostId: string) => ref.narrowTo(hostId),
}))

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => {
  const query = (prefix: string, max = Infinity, hostId: string | null = null): any => ({
    narrowTo: (host: string) => query(prefix, max, host),
    limit: (count: number) => query(prefix, count, hostId),
    get: async () => {
      const docs = Object.entries(mockDocs)
        .filter(([path]) => path.startsWith(`${prefix}/`) && !path.slice(prefix.length + 1).includes('/'))
        .filter(([, data]) => {
          if (!hostId) return true
          const visibleTo = (data['visibleTo'] as string[] | undefined) ?? []
          return visibleTo.includes('org') || visibleTo.includes(`host:${hostId}`)
        })
        .slice(0, max)
        .map(([path, data]) => ({ id: path.split('/').pop(), data: () => data }))
      return { docs, size: docs.length }
    },
  })
  const ref = (path: string): any => ({
    collection: (name: string) => ({ ...query(`${path}/${name}`), doc: (id: string) => ref(`${path}/${name}/${id}`) }),
    get: async () => ({ id: path.split('/').pop(), exists: path in mockDocs, data: () => mockDocs[path] }),
  })
  return {
    firebaseAdmin: {
      app: () => ({ firestore: () => ({ collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }) }) }),
    },
  }
})

import { datasetRecordIndex } from './dataset-record-index'

beforeEach(() => {
  mockDocs = {
    'orgs/o1/datasets/orders': {
      displayName: 'Wholesale orders',
      visibleTo: ['host:h1'],
      model: {
        order: ['state', 'total'],
        fields: { state: { name: 'State', type: 'text' }, total: { name: 'Order total', type: 'float' } },
      },
    },
    'orgs/o1/datasets/orders/records/r1': { values: { state: 'TX', total: 400 } },
    'orgs/o1/datasets/team': { displayName: 'Team', visibleTo: ['org'], fields: ['name'] },
    'orgs/o1/datasets/gone': { displayName: 'Old', visibleTo: ['org'], deletedAt: 1 },
  }
})

describe('the dataset index', () => {
  it('lists the organization’s live datasets with their fields and scope, never a record', async () => {
    const { records, truncated } = await datasetRecordIndex.list({ orgId: 'o1', limit: 10 })
    expect(truncated).toBe(false)
    expect(records).toEqual([
      {
        id: 'orders',
        name: 'Wholesale orders',
        facts: {
          fields: [
            { id: 'state', name: 'State', type: 'text' },
            { id: 'total', name: 'Order total', type: 'float' },
          ],
          visibleTo: ['host:h1'],
        },
      },
      {
        id: 'team',
        name: 'Team',
        facts: { fields: [{ id: 'name', name: 'Name', type: 'text' }], visibleTo: ['org'] },
      },
    ])
    expect(JSON.stringify(records)).not.toContain('TX')
  })

  it('narrows a site’s answer to the datasets shared with it', async () => {
    const onH1 = await datasetRecordIndex.list({ orgId: 'o1', hostId: 'h1', limit: 10 })
    expect(onH1.records.map((record) => record.id)).toEqual(['orders', 'team'])
    const onH2 = await datasetRecordIndex.list({ orgId: 'o1', hostId: 'h2', limit: 10 })
    expect(onH2.records.map((record) => record.id)).toEqual(['team'])
  })

  it('says when the scope holds more than it answered', async () => {
    const { records, truncated } = await datasetRecordIndex.list({ orgId: 'o1', limit: 1 })
    expect(records).toHaveLength(1)
    expect(truncated).toBe(true)
  })

  it('reads one live dataset, and none that is deleted, not shared with the site, or with no org', async () => {
    expect((await datasetRecordIndex.get({ orgId: 'o1', id: 'orders' }))?.name).toBe('Wholesale orders')
    expect((await datasetRecordIndex.get({ orgId: 'o1', hostId: 'h1', id: 'orders' }))?.id).toBe('orders')
    expect(await datasetRecordIndex.get({ orgId: 'o1', hostId: 'h2', id: 'orders' })).toBeNull()
    expect(await datasetRecordIndex.get({ orgId: 'o1', id: 'gone' })).toBeNull()
    expect(await datasetRecordIndex.get({ orgId: 'o1', id: 'missing' })).toBeNull()
    expect(await datasetRecordIndex.get({ orgId: null, id: 'orders' })).toBeNull()
    expect((await datasetRecordIndex.list({ orgId: null, limit: 5 })).records).toEqual([])
  })
})
