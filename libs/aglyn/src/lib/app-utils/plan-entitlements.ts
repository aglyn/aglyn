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
    managersPerTenant: 1,
    maxManagersPerTenant: 1,
    maxMembersPerHost: 1,
    bandwidthGb: 5,
    formSubmissionsPerMonth: 20,
    variablesPerHost: 3,
    functionsPerHost: 1,
    workflowsPerHost: 0,
    workflowRunsPerMonth: 0,
    servicesPerHost: 0,
    emailSendsPerMonth: 0,
    actionRunsPerMonth: 0,
    datasetsPerHost: 0,
    maxDatasetsPerHost: 0,
    recordsPerDataset: 0,
    features: {
      versioning: false,
      reusableComponents: false,
      customDomain: false,
      removeBranding: false,
      scheduledPublishing: false,
      marketplaceSelling: false,
      aiAssist: false,
      workflows: false,
      dataStore: false,
      videoMedia: false,
      bookings: false,
      actions: false,
      webhooks: false,
    },
  },
  starter: {
    hostLimit: 1,
    screensPerHost: 25,
    sharedLayoutsPerHost: 3,
    storagePerHostMb: 2048,
    totalSiteSizeMb: 1024,
    membersPerHost: 3,
    managersPerTenant: 2,
    maxManagersPerTenant: 5,
    maxMembersPerHost: 10,
    bandwidthGb: 50,
    formSubmissionsPerMonth: 200,
    variablesPerHost: 25,
    functionsPerHost: 10,
    workflowsPerHost: 3,
    workflowRunsPerMonth: 500,
    servicesPerHost: 1,
    emailSendsPerMonth: 500,
    actionRunsPerMonth: 0,
    datasetsPerHost: 1,
    maxDatasetsPerHost: 3,
    recordsPerDataset: 1000,
    features: {
      versioning: false,
      reusableComponents: true,
      customDomain: true,
      removeBranding: true,
      scheduledPublishing: false,
      marketplaceSelling: false,
      aiAssist: false,
      workflows: true,
      dataStore: true,
      videoMedia: false,
      bookings: true,
      actions: false,
      webhooks: false,
    },
  },
  pro: {
    hostLimit: 3,
    screensPerHost: 100,
    sharedLayoutsPerHost: UNLIMITED,
    storagePerHostMb: 10240,
    totalSiteSizeMb: 5120,
    membersPerHost: 10,
    managersPerTenant: 5,
    maxManagersPerTenant: 20,
    maxMembersPerHost: 25,
    bandwidthGb: 250,
    formSubmissionsPerMonth: 1000,
    variablesPerHost: 100,
    functionsPerHost: 50,
    workflowsPerHost: 25,
    workflowRunsPerMonth: 5000,
    servicesPerHost: UNLIMITED,
    emailSendsPerMonth: 5000,
    actionRunsPerMonth: 5000,
    datasetsPerHost: 10,
    maxDatasetsPerHost: 25,
    recordsPerDataset: 10000,
    features: {
      versioning: true,
      reusableComponents: true,
      customDomain: true,
      removeBranding: true,
      scheduledPublishing: false,
      marketplaceSelling: true,
      aiAssist: true,
      workflows: true,
      dataStore: true,
      videoMedia: true,
      bookings: true,
      actions: true,
      webhooks: false,
    },
  },
  business: {
    hostLimit: 10,
    screensPerHost: UNLIMITED,
    sharedLayoutsPerHost: UNLIMITED,
    storagePerHostMb: 51200,
    totalSiteSizeMb: 25600,
    membersPerHost: 50,
    managersPerTenant: 15,
    maxManagersPerTenant: 100,
    maxMembersPerHost: 100,
    bandwidthGb: 1000,
    formSubmissionsPerMonth: 10000,
    variablesPerHost: 1000,
    functionsPerHost: 250,
    workflowsPerHost: 100,
    workflowRunsPerMonth: 50000,
    servicesPerHost: UNLIMITED,
    emailSendsPerMonth: 50000,
    actionRunsPerMonth: 50000,
    datasetsPerHost: 50,
    maxDatasetsPerHost: 100,
    recordsPerDataset: 100000,
    features: {
      versioning: true,
      reusableComponents: true,
      customDomain: true,
      removeBranding: true,
      scheduledPublishing: true,
      marketplaceSelling: true,
      aiAssist: true,
      workflows: true,
      dataStore: true,
      videoMedia: true,
      bookings: true,
      actions: true,
      webhooks: true,
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
  /**
   * Monthly price per tenant-manager seat beyond `managersPerTenant`
   * (AGL-112); null when the plan cannot buy extra seats.
   */
  extraSeatMonthlyUsd: number | null
  /**
   * Monthly price per host-member seat beyond `membersPerHost` (AGL-112);
   * null when the plan cannot buy extra member seats.
   */
  extraMemberMonthlyUsd: number | null
  /**
   * Monthly price per dataset beyond `datasetsPerHost` (AGL-132); null
   * when the plan cannot buy extra datasets.
   */
  extraDatasetMonthlyUsd: number | null
}

/**
 * Flat subscription pricing per tier (AGL-68). Kept beside the entitlements
 * so price changes ride the same review path; Stripe price ids map to plans
 * via `STRIPE_PRICE_*` env vars on the billing API routes.
 */
export const PLAN_PRICING: Record<TenantPlan, PlanPricing> = {
  free: {
    basePriceMonthlyUsd: 0,
    extraHostMonthlyUsd: null,
    extraSeatMonthlyUsd: null,
    extraMemberMonthlyUsd: null,
    extraDatasetMonthlyUsd: null,
  },
  starter: {
    basePriceMonthlyUsd: 19,
    extraHostMonthlyUsd: 10,
    extraSeatMonthlyUsd: 5,
    extraMemberMonthlyUsd: 3,
    extraDatasetMonthlyUsd: 2,
  },
  pro: {
    basePriceMonthlyUsd: 49,
    extraHostMonthlyUsd: 8,
    extraSeatMonthlyUsd: 4,
    extraMemberMonthlyUsd: 2,
    extraDatasetMonthlyUsd: 2,
  },
  business: {
    basePriceMonthlyUsd: 149,
    extraHostMonthlyUsd: 5,
    extraSeatMonthlyUsd: 3,
    extraMemberMonthlyUsd: 1,
    extraDatasetMonthlyUsd: 1,
  },
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
export type SeatKind = 'managers' | 'members'

export interface SeatQuotaResult {
  /** False once usage meets the effective limit (included + purchased). */
  allowed: boolean
  /** Effective seat limit: included + purchased addons, clamped to the max. */
  limit: number
  remaining: number
  /** Included seats on the plan before addons. */
  included: number
  /** Purchased addon seats currently applied. */
  purchased: number
  /** Hard cap incl. addons; reaching it requires a plan upgrade. */
  maxSeats: number
  /**
   * True when buying more addon seats cannot raise the limit — either the
   * plan sells no addons or the hard cap is reached. UI should prompt an
   * upgrade instead of an addon purchase.
   */
  upgradeRequired: boolean
  /** Monthly price per addon seat; null when the plan sells none. */
  addonPriceUsd: number | null
}

/**
 * Seat quota check (AGL-112): seats differ from plain quotas because tenants
 * can buy addon seats (`tenant.seatAddons`) up to a per-plan hard max —
 * beyond the max the only path is upgrading the plan. `managers` counts
 * tenant-manager seats tenant-wide; `members` counts host members per host.
 */
export function checkSeatQuota(
  tenant: Partial<AglynTenant> | null | undefined,
  kind: SeatKind,
  currentUsage: number,
): SeatQuotaResult {
  const entitlements = resolveTenantEntitlements(tenant)
  const pricing = PLAN_PRICING[resolvePlan(tenant)]
  const included =
    kind === 'managers'
      ? entitlements.managersPerTenant
      : entitlements.membersPerHost
  const maxSeats =
    kind === 'managers'
      ? entitlements.maxManagersPerTenant
      : entitlements.maxMembersPerHost
  const addonPriceUsd =
    kind === 'managers'
      ? pricing.extraSeatMonthlyUsd
      : pricing.extraMemberMonthlyUsd
  const purchased = Math.max(0, tenant?.seatAddons?.[kind] ?? 0)
  const limit = Math.min(included + purchased, maxSeats)
  return {
    allowed: currentUsage < limit,
    limit,
    remaining: Math.max(0, limit - currentUsage),
    included,
    purchased,
    maxSeats,
    upgradeRequired: addonPriceUsd === null || limit >= maxSeats,
    addonPriceUsd,
  }
}

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

export interface DatasetQuotaResult {
  /** False once usage meets the effective limit (included + purchased). */
  allowed: boolean
  /** Effective dataset limit: included + purchased, clamped to the max. */
  limit: number
  remaining: number
  included: number
  purchased: number
  maxDatasets: number
  /** True when addons cannot raise the limit — upgrade instead. */
  upgradeRequired: boolean
  /** Monthly price per extra dataset; null when the plan sells none. */
  addonPriceUsd: number | null
}

/**
 * Dataset quota check (AGL-132), mirroring `checkSeatQuota`: tenants can
 * buy addon datasets (`tenant.seatAddons.datasets`, applied per host) up
 * to the plan's hard max; beyond the max the only path is upgrading.
 */
export function checkDatasetQuota(
  tenant: Partial<AglynTenant> | null | undefined,
  currentUsage: number,
): DatasetQuotaResult {
  const entitlements = resolveTenantEntitlements(tenant)
  const pricing = PLAN_PRICING[resolvePlan(tenant)]
  const included = entitlements.datasetsPerHost
  const maxDatasets = entitlements.maxDatasetsPerHost
  const addonPriceUsd = pricing.extraDatasetMonthlyUsd
  const purchased = Math.max(0, tenant?.seatAddons?.datasets ?? 0)
  const limit = Math.min(included + purchased, maxDatasets)
  return {
    allowed: currentUsage < limit,
    limit,
    remaining: Math.max(0, limit - currentUsage),
    included,
    purchased,
    maxDatasets,
    upgradeRequired: addonPriceUsd === null || limit >= maxDatasets,
    addonPriceUsd,
  }
}
