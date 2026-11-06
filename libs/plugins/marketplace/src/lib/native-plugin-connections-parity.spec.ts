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

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  PLUGIN_CONNECTION_PHASE_CHIP,
  PLUGIN_CONNECTIONS_NOT_CONFIGURED_TEXT,
  pluginConnectionNotSetUpText,
} from './model/plugin-connection-card'
import {
  PLUGIN_CONNECTIONS_API_ROUTES,
  PLUGIN_CONNECTIONS_PLAN_REFUSAL,
  PLUGIN_CONNECTIONS_SITE_PERMISSION,
} from './model/plugin-connections'

/**
 * The apps draw a site's plugin connections themselves (AGL-4196), from the
 * same manifest and the same routes as the console's card. They must say
 * what the console says, call the routes it calls, and sit in the same slot
 * of the site's plugin page.
 */

const ROOT = resolve(__dirname, '../../../../..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

const SWIFT = read('libs/plugins/marketplace/src/ios/Sources/AglynMarketplacePlugin/PluginConnections.swift')
const KOTLIN = read('libs/plugins/marketplace/src/android/src/commonMain/kotlin/com/aglyn/plugins/marketplace/PluginConnections.kt')
const NATIVES = { swift: SWIFT, kotlin: KOTLIN }

describe('the native connection screens match the console (AGL-4196)', () => {
  it.each(Object.entries(NATIVES))('%s says the plan, deployment and publisher prerequisites as the console does', (_, source) => {
    expect(source).toContain(PLUGIN_CONNECTIONS_PLAN_REFUSAL)
    expect(source).toContain(PLUGIN_CONNECTIONS_NOT_CONFIGURED_TEXT)
    // The label is interpolated natively; the sentence around it is the console's.
    const [before, after] = pluginConnectionNotSetUpText('\u0000').split('\u0000')
    expect(source).toContain(before)
    expect(source).toContain(after)
    expect(source).toContain(`"${PLUGIN_CONNECTIONS_SITE_PERMISSION}"`)
  })

  it.each(Object.entries(NATIVES))('%s wears the console’s status chips', (_, source) => {
    for (const { label } of Object.values(PLUGIN_CONNECTION_PHASE_CHIP)) expect(source).toContain(`"${label}"`)
  })

  it.each(Object.entries(NATIVES))('%s calls the console’s routes', (_, source) => {
    for (const route of ['connectStart', 'resources', 'choose', 'disconnect', 'status'] as const) {
      expect(source).toContain(`"/api/${PLUGIN_CONNECTIONS_API_ROUTES[route]}"`)
    }
    expect(source).toContain('"/api/plugin-connections/sync"')
  })

  it('both register into the slot the site plugin screen draws, as the console page does', () => {
    const screens = JSON.parse(read('libs/native/screens/site.screens.json')) as {
      screens: Array<{ id: string; blocks: Array<{ type: string; name?: string; params?: Record<string, string> }> }>
    }
    const page = screens.screens.find((one) => one.id === 'core.site.plugin')
    const zone = page?.blocks.find((block) => block.type === 'zone' && block.name === 'sitePluginConnections')
    expect(zone?.params).toEqual({ pluginId: '{params.pluginId}' })
    expect(read('libs/plugins/marketplace/src/ios/Sources/AglynMarketplacePlugin/Register.swift')).toContain(
      'slot: "sitePluginConnections"',
    )
    expect(read('libs/plugins/marketplace/src/android/src/commonMain/kotlin/com/aglyn/plugins/marketplace/Register.kt')).toContain(
      'slot = "sitePluginConnections"',
    )
    expect(read('apps/console/app/(app)/[orgSlug]/hosts/[host]/admin/plugins/[pluginRef]/page.tsx')).toContain(
      'slot="sitePluginConnections"',
    )
  })
})
