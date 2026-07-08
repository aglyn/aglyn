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
}

/**
 * Resolves through the plan/override model (`resolveTenantEntitlements`,
 * AGL-38) once the tenant has an explicit plan. Tenants without a plan
 * (pre-billing accounts) keep every feature — enforcement turns on the
 * moment a plan is assigned (checkout webhook or admin console), so rollout
 * can't strand existing users.
 */
export function hasEntitlement(
  feature: Entitlement,
  tenant?: Partial<AglynTenant> | null,
): boolean {
  if (tenant?.plan) return checkEntitlement(tenant, FEATURE_KEYS[feature])
  return true
}

/**
 * Same explicit-plan gate for quotas: returns `allowed: true` with no limit
 * enforcement until the tenant has a plan.
 */
export function checkTenantQuota(
  tenant: Partial<AglynTenant> | null | undefined,
  quota: Parameters<typeof checkQuota>[1],
  currentUsage: number,
): ReturnType<typeof checkQuota> {
  if (!tenant?.plan) {
    return { allowed: true, limit: Number.POSITIVE_INFINITY, remaining: Number.POSITIVE_INFINITY }
  }
  return checkQuota(tenant, quota, currentUsage)
}

/**
 * Seat quota (AGL-112) behind the same explicit-plan gate: pre-billing
 * tenants add users freely; once a plan exists, seats = included + purchased
 * addons up to the plan's hard max.
 */
export function checkTenantSeatQuota(
  tenant: Partial<AglynTenant> | null | undefined,
  kind: SeatKind,
  currentUsage: number,
): SeatQuotaResult {
  if (!tenant?.plan) {
    return {
      allowed: true,
      limit: Number.POSITIVE_INFINITY,
      remaining: Number.POSITIVE_INFINITY,
      included: Number.POSITIVE_INFINITY,
      purchased: 0,
      maxSeats: Number.POSITIVE_INFINITY,
      upgradeRequired: false,
      addonPriceUsd: null,
    }
  }
  return checkSeatQuota(tenant, kind, currentUsage)
}
