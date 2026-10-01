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
 * A console page offers a link to another plugin's record only where that
 * plugin's own gates would let the reader in (AGL-3080).
 *
 * The record-route registry knows nothing about the reader, and a row action
 * that lands on the shell's refusal is a link to a page that says no. So the
 * page asks who owns the kind and whether the shell would admit this reader
 * to that owner's surfaces: on for the workspace, on the plan, permitted.
 * The owner here is a `people` plugin no first-party package is, so nothing
 * below is true of one plugin only.
 */

import { renderHook } from '@testing-library/react'
import {
  registerConsoleExtension,
  unregisterConsoleExtension,
} from '@aglyn/aglyn'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerPluginRecordRoute } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'

let mockEnabled: string[] = []
let mockOrg: { org: unknown; ready: boolean } = { org: {}, ready: true }
let mockCan: (key: string) => boolean = () => true
let mockLoaded = true

jest.mock('../components/console-plugins-gate.component', () => ({
  useEnabledPluginIds: () => mockEnabled,
}))
jest.mock('./use-current-org', () => ({
  __esModule: true,
  default: () => mockOrg,
}))
jest.mock('./use-org-permissions', () => ({
  __esModule: true,
  default: () => ({ can: (key: string) => mockCan(key), permissions: {}, loaded: mockLoaded }),
}))

import { useRecordRouteOwner } from './use-record-route-owner'

const ask = () => renderHook(() => useRecordRouteOwner('person')).result.current

beforeEach(() => {
  resetPluginServicesForTests()
  unregisterConsoleExtension('people')
  mockEnabled = ['people']
  mockOrg = { org: {}, ready: true }
  mockCan = () => true
  mockLoaded = true
  registerPluginRecordRoute(
    'person',
    { list: () => '/people', record: (_context, id) => `/people/${id}` },
    { pluginId: 'people' },
  )
  registerConsoleExtension({
    pluginId: 'people',
    displayName: 'People',
    permission: 'data.manage',
  })
})

describe('who a link to a record kind would land the reader with', () => {
  it('names the owner, by what its surfaces are called, when every gate admits', () => {
    expect(ask()).toEqual({ pluginId: 'people', displayName: 'People' })
  })

  it('offers nothing for a kind no plugin publishes', () => {
    expect(renderHook(() => useRecordRouteOwner('ledgerEntry')).result.current).toBeNull()
  })

  it('offers nothing where the workspace does not run the owner', () => {
    // The registry is a session-wide union: a route registered while another
    // workspace was open must not count here.
    mockEnabled = ['something-else']
    expect(ask()).toBeNull()
  })

  it('offers nothing to a reader the owner’s permission refuses, or before it is known', () => {
    mockCan = () => false
    expect(ask()).toBeNull()
    mockCan = () => true
    mockLoaded = false
    expect(ask()).toBeNull()
  })

  it('offers nothing while the plan is unknown, or on a plan without the owner', () => {
    unregisterConsoleExtension('people')
    registerConsoleExtension({ pluginId: 'people', displayName: 'People', featureFlag: 'crm' })
    mockOrg = { org: undefined, ready: false }
    expect(ask()).toBeNull()
    mockOrg = { org: { plan: 'free' }, ready: true }
    expect(ask()).toBeNull()
  })

  it('keeps one answer across renders, so a table built from it is not rebuilt', () => {
    const { result, rerender } = renderHook(() => useRecordRouteOwner('person'))
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})
