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

import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { isHostPluginEnabled } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import type { SitePageEnricher } from '@aglyn/aglyn/plugin-manager/site-page-hooks'
import {
  WEGLOT_ENTITLEMENT,
  WEGLOT_PAGE_PROP,
  WEGLOT_PLUGIN_ID,
} from '../constants'
import { resolveWeglotSiteSettings } from '../model/weglot-settings'

/** Reads the resolved plugin settings for one site. */
export type WeglotConfigReader = (
  orgId: string | null | undefined,
  hostId: string,
) => Promise<Record<string, unknown>>

/**
 * The published page's Weglot slice (AGL-3700), decided on the server.
 *
 * Every tenant render runs every registered enricher, so this is where the
 * plugin decides whether a page carries Weglot at all, cheapest check first:
 *
 * 1. the site switched the plugin on (it is off per site until an admin
 *    turns it on) — no read;
 * 2. the workspace's plan includes `multilingual` — no read;
 * 3. the settings, at site scope, pass the same validation the settings card
 *    runs — two document reads, made only for a site that passed 1 and 2.
 *
 * Path-independent, so a designed 404 (`pathUnknown`) gets it too: a visitor
 * reading the site in French should not get the 404 in English.
 *
 * A failed settings read drops the slice rather than the page.
 */
export function createWeglotSitePageEnricher(
  readConfig: WeglotConfigReader,
): SitePageEnricher {
  return async ({ hostId, host, org }) => {
    if (!hostId || !host) return {}
    if (!isHostPluginEnabled(org ?? null, host, WEGLOT_PLUGIN_ID)) return {}
    if (!checkEntitlement(org ?? null, WEGLOT_ENTITLEMENT)) return {}
    const orgId = typeof host.orgId === 'string' ? host.orgId : null
    let config: Record<string, unknown>
    try {
      config = await readConfig(orgId, hostId)
    } catch {
      return {}
    }
    const settings = resolveWeglotSiteSettings(config)
    return settings ? { [WEGLOT_PAGE_PROP]: settings } : {}
  }
}
