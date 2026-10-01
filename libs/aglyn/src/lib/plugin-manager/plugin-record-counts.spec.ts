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
import { pluginRecordCountSource, registerPluginRecordCountSource } from './plugin-record-counts'
import { resetPluginServicesForTests } from './plugin-services'

/**
 * Record count sources (AGL-3080): the owner publishes the query a site's
 * records of a kind are counted by; a reader aggregates over it.
 */

const FIRESTORE = {} as Firestore

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

it('answers the owner’s query for a site, and whether it crosses sites', () => {
  registerPluginRecordCountSource(
    'bottle',
    { query: (_firestore, { hostId }) => ({ hostId }) as unknown as Query, crossesSites: true },
    { pluginId: 'cellar' },
  )
  const source = pluginRecordCountSource('bottle')
  expect(source?.query(FIRESTORE, { hostId: 'h1' })).toEqual({ hostId: 'h1' })
  expect(source?.crossesSites).toBe(true)
})

it('answers null for a kind nobody counts here', () => {
  expect(pluginRecordCountSource('bottle')).toBeNull()
})

it('refuses a kind another plugin counts, naming both', () => {
  registerPluginRecordCountSource('bottle', { query: () => null }, { pluginId: 'cellar' })
  expect(() =>
    registerPluginRecordCountSource('bottle', { query: () => null }, { pluginId: 'bar' }),
  ).toThrow(/cellar/)
  // The owner re-registering replaces its own.
  expect(() =>
    registerPluginRecordCountSource('bottle', { query: () => null }, { pluginId: 'cellar' }),
  ).not.toThrow()
})

it('refuses a source with no owner or no kind', () => {
  expect(() => registerPluginRecordCountSource('bottle', { query: () => null })).toThrow(/owner/)
  expect(() => registerPluginRecordCountSource(' ', { query: () => null }, { pluginId: 'cellar' })).toThrow(
    /kind/,
  )
})
