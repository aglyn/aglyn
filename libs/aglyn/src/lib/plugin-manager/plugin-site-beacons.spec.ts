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

import { resetPluginServicesForTests } from './plugin-services'
import { pluginSiteBeaconFor, registerPluginSiteBeacon } from './plugin-site-beacons'

const counted = async (): Promise<void> => undefined

afterEach(() => resetPluginServicesForTests())

describe('a plugin’s site beacon', () => {
  it('is found by the field that marks it, holding a non-empty string', () => {
    registerPluginSiteBeacon({ field: 'tasting', count: counted }, { pluginId: 'cellar' })
    expect(pluginSiteBeaconFor({ tasting: 'poured' })?.pluginId).toBe('cellar')
    expect(pluginSiteBeaconFor({ tasting: '' })).toBeNull()
    expect(pluginSiteBeaconFor({ tasting: 3 })).toBeNull()
    expect(pluginSiteBeaconFor({ path: '/' })).toBeNull()
  })

  it('has one owner per field: a second plugin is refused and the first keeps it', () => {
    registerPluginSiteBeacon({ field: 'tasting', count: counted }, { pluginId: 'cellar' })
    expect(() =>
      registerPluginSiteBeacon({ field: 'tasting', count: counted }, { pluginId: 'bar' }),
    ).toThrow(/cellar.*bar/)
    expect(pluginSiteBeaconFor({ tasting: 'poured' })?.pluginId).toBe('cellar')
  })

  it('lets its owner register again, as a second boot does', () => {
    registerPluginSiteBeacon({ field: 'tasting', count: counted }, { pluginId: 'cellar' })
    expect(() =>
      registerPluginSiteBeacon({ field: 'tasting', count: counted }, { pluginId: 'cellar' }),
    ).not.toThrow()
  })

  it('needs a field and an owner', () => {
    expect(() => registerPluginSiteBeacon({ field: ' ', count: counted }, { pluginId: 'cellar' })).toThrow()
    expect(() => registerPluginSiteBeacon({ field: 'tasting', count: counted })).toThrow()
  })
})
