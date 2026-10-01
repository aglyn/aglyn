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

import { PLUGIN_USAGE_METERS_DECLARED } from './first-party-plugins.generated'
import {
  listPluginUsageMeters,
  registerPluginUsageMeter,
  resetPluginUsageMetersForTests,
  unregisteredPluginUsageMeters,
} from './plugin-usage-meters'

const reading = async () => ({ fields: {}, billedUsd: 0 })

afterEach(() => resetPluginUsageMetersForTests())

describe('a plugin registers the meter it declared (AGL-3080)', () => {
  it('names every declared meter nothing registered, and none once registered', () => {
    const declared = PLUGIN_USAGE_METERS_DECLARED.map(
      (one) => `${one.pluginId}:${one.id}`,
    )
    // The AI plugin declares its monthly meter; a declaration that stopped
    // compiling in would leave the sweep nothing to refuse on.
    expect(declared).toContain('ai:assist')
    expect(unregisteredPluginUsageMeters()).toEqual(declared)
    for (const one of PLUGIN_USAGE_METERS_DECLARED) {
      registerPluginUsageMeter({ pluginId: one.pluginId, id: one.id, measure: reading })
    }
    expect(unregisteredPluginUsageMeters()).toEqual([])
  })

  it('runs declared meters first, in catalog order, then any other', () => {
    registerPluginUsageMeter({ pluginId: 'cellar', id: 'tastings', measure: reading })
    for (const one of [...PLUGIN_USAGE_METERS_DECLARED].reverse()) {
      registerPluginUsageMeter({ pluginId: one.pluginId, id: one.id, measure: reading })
    }
    expect(listPluginUsageMeters().map((meter) => `${meter.pluginId}:${meter.id}`)).toEqual([
      ...PLUGIN_USAGE_METERS_DECLARED.map((one) => `${one.pluginId}:${one.id}`),
      'cellar:tastings',
    ])
  })

  it('replaces a registration rather than measuring twice', () => {
    registerPluginUsageMeter({ pluginId: 'cellar', id: 'tastings', measure: reading })
    registerPluginUsageMeter({ pluginId: 'cellar', id: 'tastings', measure: reading })
    expect(listPluginUsageMeters()).toHaveLength(1)
  })

  it('refuses a meter with no owner, no id or nothing to measure', () => {
    expect(() =>
      registerPluginUsageMeter({ pluginId: ' ', id: 'tastings', measure: reading }),
    ).toThrow('needs a pluginId and an id')
    expect(() =>
      registerPluginUsageMeter({ pluginId: 'cellar', id: '', measure: reading }),
    ).toThrow('needs a pluginId and an id')
    expect(() =>
      registerPluginUsageMeter({ pluginId: 'cellar', id: 'tastings' } as never),
    ).toThrow('"cellar:tastings" has no measure function')
    expect(listPluginUsageMeters()).toEqual([])
  })
})
