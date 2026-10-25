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

import { setRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  registerPluginSiteStarterSource,
  resolveSiteStarterSource,
  type PluginSiteStarterSource,
} from './plugin-site-starters'
import { resetPluginServicesForTests } from './plugin-services'

const source = (): PluginSiteStarterSource => ({
  search: async () => [],
  resolve: async () => ({ error: 'gone', status: 404 }),
})

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('site starter source (AGL-4049)', () => {
  it('is null with no plugin registered', () => {
    expect(resolveSiteStarterSource()).toBeNull()
  })

  it('resolves the plugin that registered', () => {
    const impl = source()
    registerPluginSiteStarterSource(impl, { pluginId: 'starters' })
    expect(resolveSiteStarterSource()).toBe(impl)
  })

  it('refuses a second plugin, and the first keeps serving', () => {
    const first = source()
    registerPluginSiteStarterSource(first, { pluginId: 'starters' })
    expect(() => registerPluginSiteStarterSource(source(), { pluginId: 'other' })).toThrow(/single-implementation/)
    expect(resolveSiteStarterSource()).toBe(first)
  })

  it('lets the same plugin register again, replacing itself', () => {
    registerPluginSiteStarterSource(source(), { pluginId: 'starters' })
    const again = source()
    registerPluginSiteStarterSource(again, { pluginId: 'starters' })
    expect(resolveSiteStarterSource()).toBe(again)
  })
})
