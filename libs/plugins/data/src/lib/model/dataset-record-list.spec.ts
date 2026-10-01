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

/**
 * The workspace's datasets, as the data plugin lists them for another
 * plugin's picker (AGL-3080): a site's answer narrowed by its scope tokens
 * (the filter the rules require), the organization's own unfiltered, and
 * every row read as the server index reads it.
 */

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  documentId: () => '__name__',
  where: (field: string, op: string, value: unknown) => ({ where: [field, op, value] }),
  orderBy: (field: unknown) => ({ orderBy: field }),
  limit: (count: number) => ({ limit: count }),
  query: (base: { path: string }, ...constraints: unknown[]) => ({ path: base.path, constraints }),
}))

import { pluginRecordListSource } from '@aglyn/aglyn/plugin-manager/plugin-record-lists'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import type { Firestore } from 'firebase/firestore'
import { datasetRecordListSource, registerDatasetRecordList } from './dataset-record-list'

const DB = {} as Firestore

beforeEach(() => resetPluginServicesForTests())

describe('the dataset list source', () => {
  it('is published under this plugin', () => {
    registerDatasetRecordList()
    expect(pluginRecordListSource('dataset')?.pluginId).toBe('data')
  })

  it('narrows a site to the datasets shared with it, ordered by document id', () => {
    expect(datasetRecordListSource.query(DB, { orgId: 'o1', hostId: 'h1', limit: 101 })).toEqual({
      path: 'orgs/o1/datasets',
      constraints: [
        { where: ['visibleTo', 'array-contains-any', ['org', 'host:h1']] },
        { orderBy: '__name__' },
        { limit: 101 },
      ],
    })
  })

  it('lists the organization’s own unfiltered, and nothing with no organization', () => {
    expect(datasetRecordListSource.query(DB, { orgId: 'o1', hostId: null, limit: 51 })).toEqual({
      path: 'orgs/o1/datasets',
      constraints: [{ orderBy: '__name__' }, { limit: 51 }],
    })
    expect(datasetRecordListSource.query(DB, { orgId: null, hostId: 'h1', limit: 51 })).toBeNull()
  })

  it('reads a row as the server index does: named, with its fields and scope, and none deleted', () => {
    expect(
      datasetRecordListSource.record('team', {
        displayName: 'Team',
        visibleTo: ['org'],
        model: { order: ['name'], fields: { name: { name: 'Name', type: 'text' } } },
      }),
    ).toEqual({
      id: 'team',
      name: 'Team',
      facts: { fields: [{ id: 'name', name: 'Name', type: 'text' }], visibleTo: ['org'] },
    })
    expect(datasetRecordListSource.record('gone', { displayName: 'Old', deletedAt: 1 })).toBeNull()
  })

  /*
   * An automation step's "Save to dataset" select is built from these. Every
   * path that creates a dataset today writes `displayName` and no `name`; a
   * pre-migration dataset carries only `name`; and one with neither is still
   * offered, under its id, because a select that hides it leaves a dataset
   * that cannot be picked.
   */
  it('names a dataset by its display name, then its legacy name, then its id', () => {
    const name = (data: Record<string, unknown>) => datasetRecordListSource.record('d1', data)?.name
    expect(name({ displayName: 'Leads' })).toBe('Leads')
    expect(name({ name: 'Subscribers' })).toBe('Subscribers')
    expect(name({ displayName: 'Customers', name: 'customers_v1' })).toBe('Customers')
    expect(name({})).toBe('d1')
  })
})
