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

import type {
  AglynTenant,
  TenantEntitlements,
  TenantFeatureFlags,
  TenantPlan,
} from '../foundation'

/** Sentinel for quotas a plan does not cap; `checkQuota` always allows. */
export const UNLIMITED = Number.POSITIVE_INFINITY

/**
 * Plan → default entitlements. Versioned with the app so pricing changes are
 * code-reviewed; per-tenant overrides live on `tenant.entitlements` and win
 * key-by-key. Tier table aligned to the Tenant Billing & SaaS Plans proposal
 * (AGL-67, 2026-07-07): storage-per-host is media storage and exceeds the
 * published total-site-size cap by design. Metered costs are passed through
 * from Firebase/Vercel at cost × 1.30 separately (AGL-41).
 */
export const PLAN_ENTITLEMENTS: Record<
  TenantPlan,
  Required<Omit<TenantEntitlements, 'features'>> & {
    features: Required<TenantFeatureFlags>
  }
> = {
  free: {
    hostLimit: 1,
    screensPerHost: 5,
    sharedLayoutsPerHost: 1,
    storagePerHostMb: 250,
    totalSiteSizeMb: 100,
    membersPerHost: 1,
    bandwidthGb: 5,
    formSubmissionsPerMonth: 20,
    features: {
      versioning: false,
      reusableComponents: false,
      customDomain: false,
      removeBranding: false,
      scheduledPublishing: false,
      marketplaceSelling: false,
    },
  },
  starter: {
    hostLimit: 1,
    screensPerHost: 25,
    sharedLayoutsPerHost: 3,
    storagePerHostMb: 2048,
    totalSiteSizeMb: 1024,
    membersPerHost: 3,
    bandwidthGb: 50,
    formSubmissionsPerMonth: 200,
    features: {
      versioning: false,
      reusableComponents: true,
      customDomain: true,
      removeBranding: true,
      scheduledPublishing: false,
      marketplaceSelling: false,
    },
  },
  pro: {
    hostLimit: 3,
    screensPerHost: 100,
    sharedLayoutsPerHost: UNLIMITED,
    storagePerHostMb: 10240,
    totalSiteSizeMb: 5120,
    membersPerHost: 10,
    bandwidthGb: 250,
    formSubmissionsPerMonth: 1000,
    features: {
      versioning: true,
      reusableComponents: true,
      customDomain: true,
      removeBranding: true,
      scheduledPublishing: false,
      marketplaceSelling: true,
    },
  },
  business: {
    hostLimit: 10,
    screensPerHost: UNLIMITED,
    sharedLayoutsPerHost: UNLIMITED,
    storagePerHostMb: 51200,
    totalSiteSizeMb: 25600,
    membersPerHost: 50,
    bandwidthGb: 1000,
    formSubmissionsPerMonth: 10000,
    features: {
      versioning: true,
      reusableComponents: true,
      customDomain: true,
      removeBranding: true,
      scheduledPublishing: true,
      marketplaceSelling: true,
    },
  },
}

export interface PlanPricing {
  /** Flat monthly base price in USD. */
  basePriceMonthlyUsd: number
  /**
   * Monthly price per host beyond `hostLimit` (AGL-68); null when the plan
   * cannot buy extra hosts.
   */
  extraHostMonthlyUsd: number | null
}

/**
 * Flat subscription pricing per tier (AGL-68). Kept beside the entitlements
 * so price changes ride the same review path; Stripe price ids map to plans
 * via `STRIPE_PRICE_*` env vars on the billing API routes.
 */
export const PLAN_PRICING: Record<TenantPlan, PlanPricing> = {
  free: { basePriceMonthlyUsd: 0, extraHostMonthlyUsd: null },
  starter: { basePriceMonthlyUsd: 19, extraHostMonthlyUsd: 10 },
  pro: { basePriceMonthlyUsd: 49, extraHostMonthlyUsd: 8 },
  business: { basePriceMonthlyUsd: 149, extraHostMonthlyUsd: 5 },
}

function resolvePlan(tenant: Partial<AglynTenant> | null | undefined) {
  const plan = tenant?.plan
  return plan && plan in PLAN_ENTITLEMENTS ? plan : 'free'
}

/**
 * Effective entitlements for a tenant: plan defaults with the tenant doc's
 * per-key overrides applied (features merge key-by-key too). Missing or
 * unknown plans resolve as `free`.
 */
export function resolveTenantEntitlements(
  tenant: Partial<AglynTenant> | null | undefined,
): Required<Omit<TenantEntitlements, 'features'>> & {
  features: Required<TenantFeatureFlags>
} {
  const defaults = PLAN_ENTITLEMENTS[resolvePlan(tenant)]
  const overrides = tenant?.entitlements
  if (!overrides) return defaults
  const { features: featureOverrides, ...quotaOverrides } = overrides
  const merged = { ...defaults }
  for (const [key, value] of Object.entries(quotaOverrides)) {
    if (typeof value === 'number') (merged as any)[key] = value
  }
  return {
    ...merged,
    features: { ...defaults.features, ...featureOverrides },
  }
}

/** True when the tenant's plan (or overrides) enables the boolean feature. */
export function checkEntitlement(
  tenant: Partial<AglynTenant> | null | undefined,
  feature: keyof TenantFeatureFlags,
): boolean {
  return Boolean(resolveTenantEntitlements(tenant).features[feature])
}

/**
 * Quota check: `allowed` is false once `currentUsage` meets the limit —
 * call before creating the next resource (e.g. usage=hostCount before
 * creating another host). `remaining` never goes negative.
 */
export function checkQuota(
  tenant: Partial<AglynTenant> | null | undefined,
  quota: keyof Omit<TenantEntitlements, 'features'>,
  currentUsage: number,
): { allowed: boolean; limit: number; remaining: number } {
  const limit = resolveTenantEntitlements(tenant)[quota]
  return {
    allowed: currentUsage < limit,
    limit,
    remaining: Math.max(0, limit - currentUsage),
  }
}
