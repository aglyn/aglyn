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
import { getHostDocAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { SHIPPING_ENTITLEMENT, SHIPPING_PLUGIN_ID } from '../constants/bundle-common'

/**
 * Whether shipping runs for one site (AGL-3612): the site has an
 * organization, the organization's plan sells, and neither the workspace nor
 * the site switched this plugin off. The one question every door asks before
 * it reaches a provider, so a checkout, a label and a webhook agree.
 */
export interface ShippingSiteContext {
  orgId: string
  org: Record<string, unknown>
  host: Record<string, unknown>
}

export async function resolveShippingSite(hostId: string): Promise<ShippingSiteContext | null> {
  const [resolved, host] = await Promise.all([getOrgForHost(hostId), getHostDocAdmin(hostId)])
  if (!resolved || !host) return null
  const org = resolved.org as Record<string, unknown>
  if (!checkEntitlement(org as never, SHIPPING_ENTITLEMENT as never)) return null
  const enabled = resolveHostEnabledPlugins(
    org as { enabledPlugins?: string[] },
    host as { disabledPlugins?: string[]; enabledPlugins?: string[] },
  )
  if (!enabled.includes(SHIPPING_PLUGIN_ID)) return null
  return { orgId: resolved.orgId, org, host }
}
