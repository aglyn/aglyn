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
  registerPluginSiteStyleLooks,
  resolveSiteStyleLooks,
  type PluginSiteStyleLookSource,
} from './plugin-site-style-looks'
import { resetPluginServicesForTests } from './plugin-services'

const source = (base = 'bootstrap'): PluginSiteStyleLookSource => ({
  look: async (styleId) =>
    styleId === 'trades' ? { kind: 'builtin', base, brand: { light: { primary: '#B3261E' } }, fonts: 'oswald' } : null,
})

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('site style looks (AGL-4049)', () => {
  it('is null with no plugin registered, so a create keeps the default theme', () => {
    expect(resolveSiteStyleLooks()).toBeNull()
  })

  it('answers a style through the plugin that registered, and null for one it has no look for', async () => {
    registerPluginSiteStyleLooks(source(), { pluginId: 'ai' })
    await expect(resolveSiteStyleLooks()?.look('trades')).resolves.toEqual({
      kind: 'builtin',
      base: 'bootstrap',
      brand: { light: { primary: '#B3261E' } },
      fonts: 'oswald',
    })
    await expect(resolveSiteStyleLooks()?.look('nope')).resolves.toBeNull()
  })

  it('refuses a second plugin, and the first keeps answering', () => {
    const first = source()
    registerPluginSiteStyleLooks(first, { pluginId: 'ai' })
    expect(() => registerPluginSiteStyleLooks(source(), { pluginId: 'other' })).toThrow(/single-implementation/)
    expect(resolveSiteStyleLooks()).toBe(first)
  })

  it('lets the same plugin register again, replacing itself', () => {
    registerPluginSiteStyleLooks(source(), { pluginId: 'ai' })
    const again = source('carbon')
    registerPluginSiteStyleLooks(again, { pluginId: 'ai' })
    expect(resolveSiteStyleLooks()).toBe(again)
  })
})
