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
import { resolveHostEnabledPlugins } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import {
  filterEnabledPluginsByReleaseFlags,
  getHostDocAdmin,
  getOrgForHost,
  visitorContentRefusal,
} from '@aglyn/tenant-data-admin'
import { BUNDLE_ID, SALES_CHANNELS_ENTITLEMENT } from '../constants/bundle-common'

/** The plugin that sells: the catalog's owner, which a feed cannot run without. */
export const COMMERCE_PLUGIN_ID = 'commerce'

export type SiteSells =
  | { ok: true; orgId: string; org: Record<string, unknown>; host: Record<string, unknown> }
  | { ok: false; response: Response }

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })

/**
 * WHETHER A SITE'S FEEDS ANSWER AT ALL (AGL-3637).
 *
 * The feed is a machine route: a channel's fetcher carries no session, so
 * the tenant dispatcher skips its enablement and release gates and leaves
 * them to the route, which knows its site only once the token checks out.
 * These are those gates, the dispatcher's own decisions asked of one site:
 *
 *  - the site's workspace exists, and has commerce and this plugin switched
 *    on for the site;
 *  - both are released to the workspace;
 *  - its plan sells (`commerce`);
 *  - the site is not taken down. A full lock stops the feed the way it stops
 *    the pages, since a feed is the catalog published again.
 *
 * Every refusal but the lock is a bare 404: a feed that answers "your plan
 * lapsed" tells a stranger holding a leaked URL about the store.
 */
export async function siteSells(hostId: string): Promise<SiteSells> {
  const [resolved, host] = await Promise.all([getOrgForHost(hostId), getHostDocAdmin(hostId)])
  if (!resolved || !host) return { ok: false, response: notFound() }
  const enabled = resolveHostEnabledPlugins(
    resolved.org as { enabledPlugins?: string[] },
    host as { disabledPlugins?: string[]; enabledPlugins?: string[] },
  )
  if (!enabled.includes(COMMERCE_PLUGIN_ID) || !enabled.includes(BUNDLE_ID)) {
    return { ok: false, response: notFound() }
  }
  const released = await filterEnabledPluginsByReleaseFlags([COMMERCE_PLUGIN_ID, BUNDLE_ID], {
    orgId: resolved.orgId,
  })
  if (!released.includes(COMMERCE_PLUGIN_ID) || !released.includes(BUNDLE_ID)) {
    return { ok: false, response: notFound() }
  }
  if (!checkEntitlement(resolved.org as never, SALES_CHANNELS_ENTITLEMENT)) {
    return { ok: false, response: notFound() }
  }
  const down = await visitorContentRefusal({ hostId })
  if (down) return { ok: false, response: down }
  return { ok: true, orgId: resolved.orgId, org: resolved.org as Record<string, unknown>, host }
}
