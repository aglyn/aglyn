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
 * AGL-3080: the palette offers a plugin's records only where the plugin's
 * own pages would open — the gates every surface of its extension passes —
 * and names no plugin to do it.
 */

let mockEnabled: string[] = []
let mockGranted = new Set<string>()
let mockPermissionsLoaded = true

jest.mock('../console-plugins-gate.component', () => ({
  useEnabledPluginIds: () => mockEnabled,
}))
jest.mock('../../hooks/use-console-plugins', () => ({
  useConsoleSlotPlugins: () => true,
}))
jest.mock('../../hooks/use-org-permissions', () => ({
  useOrgPermissions: () => ({
    can: (key: string) => mockGranted.has(key),
    permissions: {},
    loaded: mockPermissionsLoaded,
  }),
}))

import {
  type ConsoleSearchSource,
  registerConsoleExtension,
  unregisterConsoleExtension,
} from '@aglyn/aglyn'
import { renderHook } from '@testing-library/react'
import { useGlobalSearchSources } from './use-global-search-sources'

const source = (id: string, extra: Partial<ConsoleSearchSource> = {}): ConsoleSearchSource => ({
  id,
  group: id,
  noun: id,
  scope: 'host',
  collection: id,
  nameField: 'name',
  order: 150,
  href: () => null,
  ...extra,
})

const PAID = { plan: 'pro' }
const FREE = { plan: 'free' }

const offered = (org: unknown = PAID, orgReady = true) =>
  renderHook(() => useGlobalSearchSources(org, orgReady)).result.current.map(
    (entity) => entity.id,
  )

beforeEach(() => {
  mockEnabled = ['cellar', 'people']
  mockGranted = new Set(['data.manage'])
  mockPermissionsLoaded = true
  registerConsoleExtension({
    pluginId: 'cellar',
    displayName: 'Cellar',
    searchSources: [
      source('bottles', { entitlementKey: 'bottlesPerHost' }),
      source('tastings', { featureFlag: 'reusableComponents' }),
    ],
  })
  registerConsoleExtension({
    pluginId: 'people',
    displayName: 'People',
    featureFlag: 'crm',
    permission: 'data.manage',
    searchSources: [source('people', { scope: 'orgData', order: 40 })],
  })
})

afterEach(() => {
  unregisterConsoleExtension('cellar')
  unregisterConsoleExtension('people')
})

describe('a plugin search source', () => {
  it('is offered as the read it declares where every gate passes', () => {
    const { result } = renderHook(() => useGlobalSearchSources(PAID, true))
    const people = result.current.find((entity) => entity.id === 'people')
    expect(people).toMatchObject({ scopeKind: 'orgData', collection: 'people', order: 40 })
    expect(result.current.map((entity) => entity.id).sort()).toEqual([
      'bottles',
      'people',
      'tastings',
    ])
  })

  /**
   * The registry is a union of every plugin the session has loaded; a
   * plugin switched off for this workspace or site must not keep answering.
   */
  it('is withheld where its plugin is off', () => {
    mockEnabled = ['cellar']
    expect(offered()).not.toContain('people')
    expect(offered()).toContain('bottles')
  })

  it("is withheld on a plan without its extension's flag, or its own", () => {
    const free = offered(FREE)
    expect(free).not.toContain('people')
    // The source's own flag composes with the extension's.
    expect(free).not.toContain('tastings')
    // A quota is the scope's to judge against the entitlements it holds.
    expect(free).toContain('bottles')
  })

  it("is withheld from a reader without its extension's permission", () => {
    mockGranted = new Set()
    expect(offered()).not.toContain('people')
    expect(offered()).toContain('bottles')
  })

  it("is withheld when the source's own permission is not granted", () => {
    unregisterConsoleExtension('cellar')
    registerConsoleExtension({
      pluginId: 'cellar',
      displayName: 'Cellar',
      searchSources: [source('bottles', { permission: 'hosts.create' })],
    })
    expect(offered()).not.toContain('bottles')
    mockGranted = new Set(['hosts.create'])
    expect(offered()).toContain('bottles')
  })

  /**
   * Unsettled is not granted: a group read for a reader it then refuses has
   * already spent the read and shown the rows.
   */
  it('is withheld while the org or the member read is unsettled', () => {
    expect(offered(PAID, false)).not.toContain('people')
    mockPermissionsLoaded = false
    expect(offered()).not.toContain('people')
    // A source nothing gates does not wait on either.
    expect(offered(PAID, false)).toContain('bottles')
  })

  it('keeps the first of two sources that claim one id', () => {
    registerConsoleExtension({
      pluginId: 'imposter',
      displayName: 'Imposter',
      searchSources: [source('bottles', { collection: 'elsewhere' })],
    })
    mockEnabled = ['cellar', 'people', 'imposter']
    const { result } = renderHook(() => useGlobalSearchSources(PAID, true))
    const bottles = result.current.filter((entity) => entity.id === 'bottles')
    expect(bottles).toHaveLength(1)
    expect(bottles[0].collection).toBe('bottles')
    unregisterConsoleExtension('imposter')
  })
})
