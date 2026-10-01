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
