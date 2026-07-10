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

import {
  type AglynTenant,
  checkEntitlement,
  checkQuota,
  checkSeatQuota,
  type SeatKind,
  type SeatQuotaResult,
  type TenantFeatureFlags,
} from '@aglyn/aglyn'

/** Console-facing feature keys mapped onto the tenant feature flags. */
export type Entitlement =
  | 'versioning'
  | 'reusable-components'
  | 'custom-domain'
  | 'remove-branding'
  | 'scheduled-publishing'
  | 'marketplace-selling'
  | 'ai-assist'
  | 'workflows'
  | 'data-store'
  | 'bookings'
  | 'actions'
  | 'webhooks'
  | 'site-export'
  | 'multilingual'
  | 'event-calendar'
  | 'redirects'
  | 'screen-analytics'
  | 'marketing-overlays'
  | 'media-cdn'
  | 'ab-testing'

const FEATURE_KEYS: Record<Entitlement, keyof TenantFeatureFlags> = {
  versioning: 'versioning',
  'reusable-components': 'reusableComponents',
  'custom-domain': 'customDomain',
  'remove-branding': 'removeBranding',
  'scheduled-publishing': 'scheduledPublishing',
  'marketplace-selling': 'marketplaceSelling',
  'ai-assist': 'aiAssist',
  workflows: 'workflows',
  'data-store': 'dataStore',
  bookings: 'bookings',
  actions: 'actions',
  webhooks: 'webhooks',
  'site-export': 'siteExport',
  multilingual: 'multilingual',
  'event-calendar': 'eventCalendar',
  redirects: 'redirects',
  'screen-analytics': 'screenAnalytics',
  'marketing-overlays': 'marketingOverlays',
  'media-cdn': 'mediaCdn',
  'ab-testing': 'abTesting',
}

/**
 * Resolves through the plan/override model (`resolveTenantEntitlements`,
 * AGL-38/247). The old dark-launch rule ("no plan = every feature") let
 * plan-less orgs reach paid features while paid orgs were gated — orgs
 * without a plan now resolve as `free`, and a dead subscription
 * (canceled/unpaid/incomplete) downgrades a paid plan to `free` inside
 * `resolveEffectivePlan`. Loading states should pass the tenant doc only
 * once it has resolved (undefined tenant still checks as free).
 */
export function hasEntitlement(
  feature: Entitlement,
  tenant?: Partial<AglynTenant> | null,
): boolean {
  return checkEntitlement(tenant, FEATURE_KEYS[feature])
}

/** Quota gate on the same effective-plan resolution (AGL-247). */
export function checkTenantQuota(
  tenant: Partial<AglynTenant> | null | undefined,
  quota: Parameters<typeof checkQuota>[1],
  currentUsage: number,
): ReturnType<typeof checkQuota> {
  return checkQuota(tenant, quota, currentUsage)
}

/** Seat quota (AGL-112) on the same effective-plan resolution. */
export function checkTenantSeatQuota(
  tenant: Partial<AglynTenant> | null | undefined,
  kind: SeatKind,
  currentUsage: number,
): SeatQuotaResult {
  return checkSeatQuota(tenant, kind, currentUsage)
}
