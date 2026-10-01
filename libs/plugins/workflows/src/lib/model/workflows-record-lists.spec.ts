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
 * A site's workflows, webhooks and actions, as this plugin lists them for
 * another plugin's picker (AGL-3080): the site's own, ordered by document id,
 * none at the organization, and every row read as the server indexes read it.
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

import {
  pluginRecordListQuery,
  pluginRecordListSource,
  pluginRecordsFromRows,
} from '@aglyn/aglyn/plugin-manager/plugin-record-lists'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import type { Firestore } from 'firebase/firestore'
import { registerWorkflowsRecordLists } from './workflows-record-lists'

const DB = {} as Firestore

beforeEach(() => {
  resetPluginServicesForTests()
  registerWorkflowsRecordLists()
})

describe('the workflows list sources', () => {
  it('publishes the three kinds it indexes, under this plugin', () => {
    for (const kind of ['workflow', 'webhook', 'action']) {
      expect(pluginRecordListSource(kind)?.pluginId).toBe('workflows')
    }
  })

  it('lists a site’s own, ordered by document id, and none at the organization', () => {
    expect(pluginRecordListQuery('workflow', DB, { hostId: 'h1', limit: 101 })).toEqual({
      path: 'hosts/h1/workflows',
      constraints: [{ orderBy: '__name__' }, { limit: 101 }],
    })
    expect(pluginRecordListQuery('action', DB, { hostId: 'h1', limit: 5 })).toMatchObject({
      path: 'hosts/h1/actions',
    })
    expect(pluginRecordListQuery('workflow', DB, { orgId: 'o1', hostId: null, limit: 5 })).toBeNull()
  })

  it('reads rows as the server indexes do: live and named, a webhook never with its URL', () => {
    expect(
      pluginRecordsFromRows('workflow', [
        { $id: 'quote', name: 'Quote', steps: [], trigger: null },
        { $id: 'gone', name: 'Old', deletedAt: 1 },
        { $id: 'unnamed', name: ' ' },
      ]).map((record) => record.id),
    ).toEqual(['quote'])
    expect(
      pluginRecordsFromRows('webhook', [
        { $id: 'zap', name: 'Zapier', direction: 'outbound', url: 'https://hooks.example.com', secret: 's' },
      ]),
    ).toEqual([{ id: 'zap', name: 'Zapier', facts: { direction: 'outbound', enabled: true } }])
  })
})
