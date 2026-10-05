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

import type { Firestore, Query } from 'firebase/firestore'
import { setRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  PLUGIN_RECORD_LIST_IDS_MAX,
  pluginRecordListByIdsQuery,
  pluginRecordListQuery,
  pluginRecordListSource,
  pluginRecordsFromRows,
  registerPluginRecordListSource,
  type PluginRecordListSource,
} from './plugin-record-lists'
import { resetPluginServicesForTests } from './plugin-services'

/**
 * Record list sources (AGL-3080): the console-side half of the record index —
 * an owner publishes the query a scope is read by and how a stored document
 * reads as a record, and a reader runs it with its own listener.
 */

const FIRESTORE = {} as Firestore

const source = (label: string): PluginRecordListSource => ({
  query: (_firestore, request) =>
    request.hostId ? ({ label, hostId: request.hostId, limit: request.limit } as unknown as Query) : null,
  record: (id, data) =>
    data['deletedAt'] == null && typeof data['name'] === 'string' ? { id, name: data['name'], facts: { label } } : null,
})

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('record list sources', () => {
  it('answers the query a plugin published for a kind, in the scope asked', () => {
    registerPluginRecordListSource('bottle', source('cellar'), { pluginId: 'cellar' })
    expect(pluginRecordListSource('bottle')?.pluginId).toBe('cellar')
    expect(pluginRecordListQuery('bottle', FIRESTORE, { hostId: 'h1', limit: 11 })).toEqual({
      label: 'cellar',
      hostId: 'h1',
      limit: 11,
    })
    // A scope the kind has none in answers no query.
    expect(pluginRecordListQuery('bottle', FIRESTORE, { hostId: null, limit: 11 })).toBeNull()
  })

  it('reads a listener’s rows through their owner, leaving out what it leaves out', () => {
    registerPluginRecordListSource('bottle', source('cellar'), { pluginId: 'cellar' })
    expect(
      pluginRecordsFromRows('bottle', [
        { $id: 'b1', name: 'Rioja' },
        { $id: 'b2', name: 'Old', deletedAt: 1 },
        { $id: 'b3' },
      ]),
    ).toEqual([{ id: 'b1', name: 'Rioja', facts: { label: 'cellar' } }])
  })

  it('hands the owner the whole request, a member’s scope and an install’s listing included', () => {
    const asked: unknown[] = []
    registerPluginRecordListSource(
      'bottle',
      {
        query: (_firestore, request) => {
          asked.push(request)
          return null
        },
        record: () => null,
      },
      { pluginId: 'cellar' },
    )
    pluginRecordListQuery('bottle', FIRESTORE, {
      orgId: 'o1',
      memberScope: ['host:h1'],
      installedFrom: 'listing-1',
      limit: 21,
    })
    expect(asked).toEqual([{ orgId: 'o1', memberScope: ['host:h1'], installedFrom: 'listing-1', limit: 21 }])
  })

  it('hands the rows back with the request, so the owner applies what the query could not state', () => {
    registerPluginRecordListSource(
      'view',
      {
        query: () => null,
        // A member's private view is theirs to list, and nobody else's.
        record: (id, data, request) =>
          data['shared'] === true || (request?.viewerUid && data['ownerUid'] === request.viewerUid)
            ? { id, name: String(data['name']), facts: {} }
            : null,
      },
      { pluginId: 'cellar' },
    )
    const rows = [
      { $id: 'v1', name: 'Shared', shared: true },
      { $id: 'v2', name: 'Mine', ownerUid: 'u1' },
      { $id: 'v3', name: 'Theirs', ownerUid: 'u2' },
    ]
    expect(pluginRecordsFromRows('view', rows, '$id', { viewerUid: 'u1', limit: 5 }).map((record) => record.id)).toEqual([
      'v1',
      'v2',
    ])
    // No reader named: only what is shared.
    expect(pluginRecordsFromRows('view', rows).map((record) => record.id)).toEqual(['v1'])
  })

  it('answers no query and no records for a kind no plugin keeps here', () => {
    expect(pluginRecordListSource('bottle')).toBeNull()
    expect(pluginRecordListQuery('bottle', FIRESTORE, { hostId: 'h1', limit: 5 })).toBeNull()
    expect(pluginRecordsFromRows('bottle', [{ $id: 'b1', name: 'Rioja' }])).toEqual([])
  })

  it('refuses a second plugin on a kind, and the first keeps serving', () => {
    registerPluginRecordListSource('bottle', source('cellar'), { pluginId: 'cellar' })
    expect(() =>
      registerPluginRecordListSource('bottle', source('other'), { pluginId: 'other-cellar' }),
    ).toThrow(/already listed by "cellar"; refused "other-cellar"/)
    expect(pluginRecordListSource('bottle')?.pluginId).toBe('cellar')
  })

  it('lets the owner register again, replacing its own', () => {
    registerPluginRecordListSource('bottle', source('cellar'), { pluginId: 'cellar' })
    registerPluginRecordListSource('bottle', source('cellar v2'), { pluginId: 'cellar' })
    expect(pluginRecordsFromRows('bottle', [{ $id: 'b1', name: 'Rioja' }])[0]?.facts).toEqual({
      label: 'cellar v2',
    })
  })

  it('refuses a source with no kind or no owner', () => {
    expect(() => registerPluginRecordListSource(' ', source('x'), { pluginId: 'cellar' })).toThrow(/kind/)
    expect(() => registerPluginRecordListSource('bottle', source('x'))).toThrow(/no owner/)
  })
})

describe('records by name', () => {
  it('asks the owner for at most thirty named records at a time', () => {
    const asked: string[][] = []
    registerPluginRecordListSource(
      'bottle',
      {
        ...source('cellar'),
        byIds: (_firestore, request) => {
          asked.push([...request.ids])
          return { ids: request.ids } as unknown as Query
        },
      },
      { pluginId: 'cellar' },
    )
    const ids = Array.from({ length: 40 }, (_, index) => `b${index}`)
    expect(pluginRecordListByIdsQuery('bottle', FIRESTORE, { hostId: 'h1', ids })).toEqual({
      ids: ids.slice(0, PLUGIN_RECORD_LIST_IDS_MAX),
    })
    expect(asked[0]).toHaveLength(30)
    // No ids asks for nothing, and says so without asking.
    expect(pluginRecordListByIdsQuery('bottle', FIRESTORE, { hostId: 'h1', ids: ['', ''] })).toBeNull()
    expect(asked).toHaveLength(1)
  })

  it('answers nothing where the source reads none by name, or no plugin keeps the kind', () => {
    registerPluginRecordListSource('bottle', source('cellar'), { pluginId: 'cellar' })
    expect(pluginRecordListByIdsQuery('bottle', FIRESTORE, { hostId: 'h1', ids: ['b1'] })).toBeNull()
    expect(pluginRecordListByIdsQuery('glass', FIRESTORE, { hostId: 'h1', ids: ['g1'] })).toBeNull()
  })
})
