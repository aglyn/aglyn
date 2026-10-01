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

import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * A plugin's own beacons, posted to the platform's site collector.
 *
 * A published page has one place to report what visitors did — the
 * collector behind `sendAnalyticsBeacon` — and that endpoint owns what every
 * beacon owes before anything is counted: the host must exist, a platform,
 * org or site lockdown refuses it silently, and the per-address rate limit
 * applies. What a plugin's site runtime reports beyond a pageview (an
 * announcement bar seen, a popup dismissed) is the plugin's to count, in its
 * own documents.
 *
 * So the plugin registers a beacon by the body FIELD that marks it as its
 * own, and the collector hands a beacon carrying that field to the plugin
 * after its own gates, then answers 204 without counting a pageview. The
 * field is the beacon's whole claim: one owner per field, refused naming
 * both, and the incumbent keeps serving.
 *
 * Registered from the plugin's `serverDeclarations`, so every server process
 * has it from boot; keep the registration light and import the counting
 * code on the first beacon.
 */

/** What the collector hands the owner, after the host and lockdown gates. */
export interface PluginSiteBeaconRequest {
  hostId: string
  /** The collector's day bucket, `YYYY-MM-DD` in UTC. */
  day: string
  /**
   * When the site's analytics document for {@link day} expires: the
   * platform's retention. An owner that writes into that document stamps it,
   * so a document created by its beacons alone is still swept.
   */
  dayExpiresAt: Date
  /** The beacon as the browser sent it. Untrusted: validate every field read. */
  body: Readonly<Record<string, unknown>>
}

export interface PluginSiteBeacon {
  /** The body field whose non-empty string marks a beacon as this plugin's. */
  field: string
  /** Counts one beacon. A throw is logged by the collector, never surfaced. */
  count(request: PluginSiteBeaconRequest): Promise<void>
}

export const PLUGIN_SITE_BEACONS = definePluginServiceContract<PluginSiteBeacon>(
  'core.site-beacons',
  { multiple: true },
)

/**
 * Registers a beacon. The owner is the loader's marker inside a register fn,
 * else `options.pluginId`; with neither the registration throws. A field
 * another plugin claims throws naming both.
 */
export function registerPluginSiteBeacon(
  beacon: PluginSiteBeacon,
  options?: { pluginId?: string },
): void {
  const field = String(beacon.field ?? '').trim()
  if (!field) throw new Error('a site beacon needs the body field that marks it')
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) throw new Error(`the site beacon "${field}" was registered with no owner`)
  const incumbent = resolvePluginServices(PLUGIN_SITE_BEACONS).find((entry) => entry.key === field)
  if (incumbent && incumbent.pluginId !== pluginId) {
    throw new Error(
      `site beacon field "${field}" is already counted by "${incumbent.pluginId}"; refused "${pluginId}"`,
    )
  }
  registerPluginService(PLUGIN_SITE_BEACONS, { ...beacon, field }, { pluginId, key: field })
}

/** The owner of a beacon body, or `null` when no registered field marks it. */
export function pluginSiteBeaconFor(
  body: Readonly<Record<string, unknown>>,
): { pluginId: string; beacon: PluginSiteBeacon } | null {
  for (const entry of resolvePluginServices(PLUGIN_SITE_BEACONS)) {
    const value = body[entry.impl.field]
    if (typeof value === 'string' && value) return { pluginId: entry.pluginId, beacon: entry.impl }
  }
  return null
}
