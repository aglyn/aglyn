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
import {
  REVIEW_PLATFORMS_ENTITLEMENT,
  REVIEW_PLATFORMS_PLUGIN_ID,
  SELLER_PLUGIN_ID,
} from '../constants/bundle-common'

/**
 * Whether review platforms run for one site (AGL-3699): the site has an
 * organization, the organization's plan sells, neither the workspace nor the
 * site switched this plugin off, and commerce — whose orders it follows — is
 * on for the site. Every door asks before it reaches a service, so a route,
 * an event and an email agree.
 */
export interface ReviewPlatformsSiteContext {
  orgId: string
  org: Record<string, unknown>
  host: Record<string, unknown>
}

type SiteResolver = (hostId: string) => Promise<ReviewPlatformsSiteContext | null>

let override: SiteResolver | null = null

/** Test seam. */
export function setReviewPlatformsSiteResolverForTests(resolver: SiteResolver | null): void {
  override = resolver
}

export async function resolveReviewPlatformsSite(hostId: string): Promise<ReviewPlatformsSiteContext | null> {
  if (override) return override(hostId)
  const [resolved, host] = await Promise.all([getOrgForHost(hostId), getHostDocAdmin(hostId)])
  if (!resolved || !host) return null
  const org = resolved.org as Record<string, unknown>
  if (!checkEntitlement(org as never, REVIEW_PLATFORMS_ENTITLEMENT as never)) return null
  const enabled = resolveHostEnabledPlugins(
    org as { enabledPlugins?: string[] },
    host as { disabledPlugins?: string[]; enabledPlugins?: string[] },
  )
  if (!enabled.includes(REVIEW_PLATFORMS_PLUGIN_ID) || !enabled.includes(SELLER_PLUGIN_ID)) return null
  return { orgId: resolved.orgId, org, host: host as Record<string, unknown> }
}
