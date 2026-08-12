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
  AglynOrgBilling,
  OrgBrandingProfile,
  OrgDiscount,
  OrgEntitlements,
  OrgFeatureFlags,
  OrgPlan,
  OrgSeatAddons,
} from '../foundation'

/** Sentinel for quotas a plan does not cap; `checkQuota` always allows. */
export const UNLIMITED = Number.POSITIVE_INFINITY

/**
 * Plan → default entitlements. Versioned with the app so pricing changes are
 * code-reviewed; per-org overrides live on `org.entitlements` and win
 * key-by-key. Tier table aligned to the Tenant Billing & SaaS Plans proposal
 * (AGL-67, 2026-07-07): storage-per-host is media storage and exceeds the
 * published total-site-size cap by design. Metered costs are passed through
 * from Firebase/Vercel at cost × 1.30 separately (AGL-41).
 */
/** Legacy host-keyed dataset overrides resolved into org keys (AGL-240). */
type LegacyEntitlementKeys = 'datasetsPerHost' | 'maxDatasetsPerHost'

/** Fully-resolved entitlements: every quota present, features complete. */
export type ResolvedOrgEntitlements = Required<
  Omit<OrgEntitlements, 'features' | LegacyEntitlementKeys>
> & {
  features: Required<OrgFeatureFlags>
}

export const PLAN_ENTITLEMENTS: Record<OrgPlan, ResolvedOrgEntitlements> = {
  free: {
    hostLimit: 1,
    screensPerHost: 5,
    sharedLayoutsPerHost: 1,
    templatesPerHost: 10,
    storagePerHostMb: 250,
    totalSiteSizeMb: 100,
    membersPerHost: 1,
    managersPerOrg: 1,
    maxManagersPerOrg: 1,
    maxMembersPerHost: 1,
    bandwidthGb: 5,
    formSubmissionsPerMonth: 20,
    variablesPerHost: 3,
    functionsPerHost: 1,
    workflowsPerHost: 0,
    workflowRunsPerMonth: 0,
    servicesPerHost: 0,
    redirectsPerHost: 0,
    contactsPerHost: 100,
    emailSendsPerMonth: 0,
    actionRunsPerMonth: 0,
    apiRequestsPerMonth: 0,
    datasetsPerOrg: 0,
    maxDatasetsPerOrg: 0,
    recordsPerDataset: 0,
    dataStorageMbPerOrg: 0,
    productsPerHost: 0,
    inventoryLocations: 1,
    posRegisters: 0,
    transactionFeePhysicalPct: 0,
    transactionFeeDigitalPct: 0,
    features: {
      abTesting: false,
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
      interactions: true,
      actions: false,
      webhooks: false,
      apiAccess: false,
      siteExport: false,
      multilingual: false,
      eventCalendar: false,
      redirects: false,
      screenAnalytics: false,
      mediaCdn: false,
      marketingOverlays: false,
      commerce: false,
      pos: false,
      storefrontSubscriptions: false,
      contentGating: false,
      giftCards: false,
      productReviews: false,
      abandonedCart: false,
      dropshipRouting: false,
      commerceAnalytics: false,
      whiteLabel: false,
      ssoEnabled: false,
    },
  },
  starter: {
    hostLimit: 1,
    screensPerHost: 25,
    sharedLayoutsPerHost: 3,
    templatesPerHost: 50,
    storagePerHostMb: 2048,
    totalSiteSizeMb: 1024,
    membersPerHost: 3,
    managersPerOrg: 2,
    maxManagersPerOrg: 5,
    maxMembersPerHost: 10,
    bandwidthGb: 50,
    formSubmissionsPerMonth: 200,
    variablesPerHost: 25,
    functionsPerHost: 10,
    workflowsPerHost: 3,
    workflowRunsPerMonth: 500,
    servicesPerHost: 1,
    redirectsPerHost: 25,
    contactsPerHost: 1000,
    emailSendsPerMonth: 500,
    actionRunsPerMonth: 0,
    apiRequestsPerMonth: 0,
    datasetsPerOrg: 3,
    maxDatasetsPerOrg: 10,
    recordsPerDataset: 1000,
    dataStorageMbPerOrg: 1024,
    productsPerHost: 100,
    inventoryLocations: 1,
    posRegisters: 0,
    transactionFeePhysicalPct: 2,
    // Pricing v3 (2026-07): softened 7→5 — a 7% digital fee stacked on the
    // ~2.9%+30¢ processor was ~10% all-in, far above the website-builder
    // norm (Wix/BigCommerce/Squarespace-Core = 0% platform fee). See the
    // Pricing Decision Log + Competitive Benchmark.
    transactionFeeDigitalPct: 5,
    features: {
      abTesting: false,
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
      interactions: true,
      actions: false,
      webhooks: false,
      apiAccess: false,
      siteExport: false,
      multilingual: false,
      eventCalendar: false,
      redirects: true,
      screenAnalytics: false,
      mediaCdn: true,
      marketingOverlays: true,
      commerce: true,
      pos: false,
      storefrontSubscriptions: false,
      contentGating: false,
      giftCards: false,
      productReviews: false,
      abandonedCart: false,
      dropshipRouting: false,
      commerceAnalytics: false,
      whiteLabel: false,
      ssoEnabled: false,
    },
  },
  pro: {
    hostLimit: 3,
    screensPerHost: 100,
    sharedLayoutsPerHost: UNLIMITED,
    templatesPerHost: UNLIMITED,
    storagePerHostMb: 10240,
    totalSiteSizeMb: 5120,
    membersPerHost: 10,
    managersPerOrg: 5,
    maxManagersPerOrg: 20,
    maxMembersPerHost: 25,
    bandwidthGb: 250,
    formSubmissionsPerMonth: 1000,
    variablesPerHost: 100,
    functionsPerHost: 50,
    workflowsPerHost: 25,
    workflowRunsPerMonth: 5000,
    servicesPerHost: UNLIMITED,
    redirectsPerHost: 100,
    contactsPerHost: 10000,
    emailSendsPerMonth: 5000,
    actionRunsPerMonth: 5000,
    apiRequestsPerMonth: 0,
    datasetsPerOrg: 15,
    maxDatasetsPerOrg: 50,
    recordsPerDataset: 10000,
    dataStorageMbPerOrg: 5120,
    productsPerHost: 2500,
    inventoryLocations: 2,
    posRegisters: 1,
    transactionFeePhysicalPct: 0,
    // Pricing v3 (2026-07): softened 5→3 to smooth the digital fee ladder
    // (Starter 5 → Pro 3 → Business 2 → Scale 1 → Advanced/Agency 0).
    transactionFeeDigitalPct: 3,
    features: {
      abTesting: false,
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
      interactions: true,
      actions: true,
      webhooks: false,
      apiAccess: false,
      siteExport: true,
      multilingual: false,
      eventCalendar: false,
      redirects: true,
      screenAnalytics: true,
      mediaCdn: true,
      marketingOverlays: true,
      commerce: true,
      pos: true,
      storefrontSubscriptions: false,
      contentGating: false,
      giftCards: false,
      productReviews: true,
      abandonedCart: true,
      dropshipRouting: true,
      commerceAnalytics: true,
      whiteLabel: false,
      ssoEnabled: false,
    },
  },
  business: {
    hostLimit: 10,
    screensPerHost: UNLIMITED,
    sharedLayoutsPerHost: UNLIMITED,
    templatesPerHost: UNLIMITED,
    storagePerHostMb: 51200,
    totalSiteSizeMb: 25600,
    membersPerHost: 50,
    managersPerOrg: 15,
    maxManagersPerOrg: 100,
    maxMembersPerHost: 100,
    bandwidthGb: 1000,
    formSubmissionsPerMonth: 10000,
    variablesPerHost: 1000,
    functionsPerHost: 250,
    workflowsPerHost: 100,
    workflowRunsPerMonth: 50000,
    servicesPerHost: UNLIMITED,
    redirectsPerHost: UNLIMITED,
    contactsPerHost: 100000,
    emailSendsPerMonth: 50000,
    actionRunsPerMonth: 50000,
    apiRequestsPerMonth: 100_000,
    datasetsPerOrg: 100,
    maxDatasetsPerOrg: 250,
    recordsPerDataset: 100000,
    dataStorageMbPerOrg: 25600,
    productsPerHost: 10000,
    inventoryLocations: 4,
    posRegisters: 2,
    transactionFeePhysicalPct: 0,
    transactionFeeDigitalPct: 2,
    features: {
      abTesting: true,
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
      interactions: true,
      actions: true,
      webhooks: true,
      apiAccess: true,
      siteExport: true,
      multilingual: true,
      eventCalendar: false,
      redirects: true,
      screenAnalytics: true,
      mediaCdn: true,
      marketingOverlays: true,
      commerce: true,
      pos: true,
      storefrontSubscriptions: true,
      contentGating: true,
      giftCards: true,
      productReviews: true,
      abandonedCart: true,
      dropshipRouting: true,
      commerceAnalytics: true,
      whiteLabel: false,
      ssoEnabled: false,
    },
  },
  // Scale (Pricing v3, 2026-07): fills the $139→$399 gap. Feature set equals
  // Business/Advanced (all commerce features); limits interpolate between
  // Business and Advanced; digital platform fee drops to 1%.
  scale: {
    hostLimit: 15,
    screensPerHost: UNLIMITED,
    sharedLayoutsPerHost: UNLIMITED,
    templatesPerHost: UNLIMITED,
    storagePerHostMb: 76800,
    totalSiteSizeMb: 38400,
    membersPerHost: 75,
    managersPerOrg: 25,
    maxManagersPerOrg: 150,
    maxMembersPerHost: 150,
    bandwidthGb: 2500,
    formSubmissionsPerMonth: 50000,
    variablesPerHost: 5000,
    functionsPerHost: 500,
    workflowsPerHost: 250,
    workflowRunsPerMonth: 150000,
    servicesPerHost: UNLIMITED,
    redirectsPerHost: UNLIMITED,
    contactsPerHost: 500000,
    emailSendsPerMonth: 100000,
    actionRunsPerMonth: 100000,
    apiRequestsPerMonth: 300000,
    datasetsPerOrg: 250,
    maxDatasetsPerOrg: 500,
    recordsPerDataset: 500000,
    dataStorageMbPerOrg: 51200,
    productsPerHost: 25000,
    inventoryLocations: 6,
    posRegisters: 3,
    transactionFeePhysicalPct: 0,
    transactionFeeDigitalPct: 1,
    features: {
      abTesting: true,
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
      interactions: true,
      actions: true,
      webhooks: true,
      apiAccess: true,
      siteExport: true,
      multilingual: true,
      eventCalendar: false,
      redirects: true,
      screenAnalytics: true,
      mediaCdn: true,
      marketingOverlays: true,
      commerce: true,
      pos: true,
      storefrontSubscriptions: true,
      contentGating: true,
      giftCards: true,
      productReviews: true,
      abandonedCart: true,
      dropshipRouting: true,
      commerceAnalytics: true,
      whiteLabel: false,
      ssoEnabled: false,
    },
  },
  advanced: {
    hostLimit: 25,
    screensPerHost: UNLIMITED,
    sharedLayoutsPerHost: UNLIMITED,
    templatesPerHost: UNLIMITED,
    storagePerHostMb: 102400,
    totalSiteSizeMb: 51200,
    membersPerHost: 100,
    managersPerOrg: 50,
    maxManagersPerOrg: 250,
    maxMembersPerHost: 250,
    bandwidthGb: 5000,
    formSubmissionsPerMonth: 100000,
    variablesPerHost: UNLIMITED,
    functionsPerHost: 1000,
    workflowsPerHost: 500,
    workflowRunsPerMonth: 500000,
    servicesPerHost: UNLIMITED,
    redirectsPerHost: UNLIMITED,
    contactsPerHost: 1000000,
    emailSendsPerMonth: 250000,
    actionRunsPerMonth: 250000,
    apiRequestsPerMonth: 1_000_000,
    datasetsPerOrg: 500,
    maxDatasetsPerOrg: 1000,
    recordsPerDataset: 1000000,
    dataStorageMbPerOrg: 102400,
    productsPerHost: UNLIMITED,
    inventoryLocations: 10,
    posRegisters: 5,
    transactionFeePhysicalPct: 0,
    transactionFeeDigitalPct: 0,
    features: {
      abTesting: true,
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
      interactions: true,
      actions: true,
      webhooks: true,
      apiAccess: true,
      siteExport: true,
      multilingual: true,
      eventCalendar: false,
      redirects: true,
      screenAnalytics: true,
      mediaCdn: true,
      marketingOverlays: true,
      commerce: true,
      pos: true,
      storefrontSubscriptions: true,
      contentGating: true,
      giftCards: true,
      productReviews: true,
      abandonedCart: true,
      dropshipRouting: true,
      commerceAnalytics: true,
      whiteLabel: false,
      ssoEnabled: false,
    },
  },
  // Agency (Pricing v3, 2026-07): high-volume multi-site tier above Advanced.
  // 100 sites, 0% fees, top-of-ladder capacity. Positioned for agencies /
  // resellers — white-label, SSO, and an SLA are the follow-on product work
  // that will further differentiate it (see the Pricing Decision Log).
  agency: {
    hostLimit: 100,
    screensPerHost: UNLIMITED,
    sharedLayoutsPerHost: UNLIMITED,
    templatesPerHost: UNLIMITED,
    storagePerHostMb: 204800,
    totalSiteSizeMb: 102400,
    membersPerHost: 250,
    managersPerOrg: 100,
    maxManagersPerOrg: 500,
    maxMembersPerHost: 1000,
    bandwidthGb: 20000,
    formSubmissionsPerMonth: UNLIMITED,
    variablesPerHost: UNLIMITED,
    functionsPerHost: UNLIMITED,
    workflowsPerHost: UNLIMITED,
    workflowRunsPerMonth: 2000000,
    servicesPerHost: UNLIMITED,
    redirectsPerHost: UNLIMITED,
    contactsPerHost: UNLIMITED,
    emailSendsPerMonth: 1000000,
    actionRunsPerMonth: 1000000,
    apiRequestsPerMonth: 5000000,
    datasetsPerOrg: 2000,
    maxDatasetsPerOrg: 5000,
    recordsPerDataset: UNLIMITED,
    dataStorageMbPerOrg: 512000,
    productsPerHost: UNLIMITED,
    inventoryLocations: 50,
    posRegisters: 20,
    transactionFeePhysicalPct: 0,
    transactionFeeDigitalPct: 0,
    features: {
      abTesting: true,
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
      interactions: true,
      actions: true,
      webhooks: true,
      apiAccess: true,
      siteExport: true,
      multilingual: true,
      eventCalendar: false,
      redirects: true,
      screenAnalytics: true,
      mediaCdn: true,
      marketingOverlays: true,
      commerce: true,
      pos: true,
      storefrontSubscriptions: true,
      contentGating: true,
      giftCards: true,
      productReviews: true,
      abandonedCart: true,
      dropshipRouting: true,
      commerceAnalytics: true,
      // White-Label Phase 1: the Agency-tier ($799) differentiator. Only
      // this tier and Enterprise ship white-label by default.
      whiteLabel: true,
      ssoEnabled: false,
    },
  },
  // Enterprise (AGL-1118): the top of the ladder and the ONLY custom-priced
  // tier — staff-provisioned per deal (AGL-1110), never sold self-serve, so it
  // is excluded from `SELF_SERVE_PLANS` and carries no list price in
  // `PLAN_PRICING`. Capacity is Agency's, uncapped: EVERY quota is UNLIMITED,
  // byte-size ones included — infra cost is metered and priced into the deal,
  // so a hard wall would only break a customer already paying for the usage.
  // This is the one tier where the AGL-67 "media storage exceeds the
  // published-site cap" invariant is vacuous: both are unbounded.
  // White-label AND SSO ship on the plan itself rather than through the
  // per-org `entitlements` override that Enterprise-as-a-label needed.
  enterprise: {
    hostLimit: UNLIMITED,
    screensPerHost: UNLIMITED,
    sharedLayoutsPerHost: UNLIMITED,
    templatesPerHost: UNLIMITED,
    storagePerHostMb: UNLIMITED,
    totalSiteSizeMb: UNLIMITED,
    membersPerHost: UNLIMITED,
    managersPerOrg: UNLIMITED,
    maxManagersPerOrg: UNLIMITED,
    maxMembersPerHost: UNLIMITED,
    bandwidthGb: UNLIMITED,
    formSubmissionsPerMonth: UNLIMITED,
    variablesPerHost: UNLIMITED,
    functionsPerHost: UNLIMITED,
    workflowsPerHost: UNLIMITED,
    workflowRunsPerMonth: UNLIMITED,
    servicesPerHost: UNLIMITED,
    redirectsPerHost: UNLIMITED,
    contactsPerHost: UNLIMITED,
    emailSendsPerMonth: UNLIMITED,
    actionRunsPerMonth: UNLIMITED,
    apiRequestsPerMonth: UNLIMITED,
    datasetsPerOrg: UNLIMITED,
    maxDatasetsPerOrg: UNLIMITED,
    recordsPerDataset: UNLIMITED,
    dataStorageMbPerOrg: UNLIMITED,
    productsPerHost: UNLIMITED,
    inventoryLocations: UNLIMITED,
    posRegisters: UNLIMITED,
    transactionFeePhysicalPct: 0,
    transactionFeeDigitalPct: 0,
    features: {
      abTesting: true,
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
      interactions: true,
      actions: true,
      webhooks: true,
      apiAccess: true,
      siteExport: true,
      multilingual: true,
      // Event Calendar stays an add-on purchase, as on every other tier.
      eventCalendar: false,
      redirects: true,
      screenAnalytics: true,
      mediaCdn: true,
      marketingOverlays: true,
      commerce: true,
      pos: true,
      storefrontSubscriptions: true,
      contentGating: true,
      giftCards: true,
      productReviews: true,
      abandonedCart: true,
      dropshipRouting: true,
      commerceAnalytics: true,
      whiteLabel: true,
      // SSO (AGL-1101) is the Enterprise differentiator — the only plan that
      // carries it by default. Lower tiers still need a per-org override.
      ssoEnabled: true,
    },
  },
}

/**
 * The tiers a customer can buy themselves — every plan EXCEPT `enterprise`
 * (AGL-1118), which is priced per deal and provisioned by staff (AGL-1110).
 * Any surface that offers plans for sale (the console plan-cards grid, the
 * marketing pricing table, the plan-change dialog) MUST iterate this rather
 * than `Object.keys(PLAN_ENTITLEMENTS)`, so a custom-priced tier can never
 * show a self-serve Upgrade button or a $0 headline price.
 */
export const SELF_SERVE_PLANS: OrgPlan[] = [
  'free',
  'starter',
  'pro',
  'business',
  'scale',
  'advanced',
  'agency',
]

/**
 * Whether the plan has no list price and is quoted per deal (AGL-1118).
 * `PLAN_PRICING` still carries a row for it — the record is exhaustive by
 * type — but every figure there is 0/null and means "no list price", NOT
 * "free". Revenue for such an org comes from `subscription.customMonthlyUsd`.
 */
export function isCustomPricedPlan(plan: OrgPlan | undefined | null): boolean {
  return plan === 'enterprise'
}

/** Human plan names — the ONE source every plan badge/label reads. */
export const PLAN_LABELS: Record<OrgPlan, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  business: 'Business',
  scale: 'Scale',
  advanced: 'Advanced',
  agency: 'Agency',
  enterprise: 'Enterprise',
}

/**
 * Event Calendar add-on (AGL-145): first-party, Aglyn-supported, $9/mo
 * **per organization** — cost×1.3 floor honored (mostly Firestore reads).
 * Enabled via the `eventCalendar` entitlement override at purchase.
 *
 * NOT per host, despite what this comment said until AGL-1279. AGL-145
 * shipped it per host; AGL-526 then made add-ons self-serve and capped this
 * one at `return 1` in `app/api/billing/addons/route.ts`, and
 * `resolveOrgEntitlements` flips a single org-level `features.eventCalendar`
 * boolean from any quantity >= 1. One purchase covers every host in the org.
 * The marketing copy on /pricing is written against that behaviour.
 */
export const EVENT_CALENDAR_ADDON_MONTHLY_USD = 9

/**
 * POS Pro register add-on (AGL-329): $89/mo per extra register/location
 * (Shopify POS Pro parity). Purchased add-ons land as a per-org
 * `posRegisters` entitlement override, which
 * `resolveOrgEntitlements` already applies over the plan default.
 */
export const POS_REGISTER_ADDON_MONTHLY_USD = 89

export interface PlanPricing {
  /** Flat monthly base price in USD (month-to-month billing). */
  basePriceMonthlyUsd: number
  /**
   * Effective per-month price when billed annually (AGL-278): the
   * Squarespace/Shopify-parity headline number. Charged as ×12 up front.
   */
  basePriceAnnualMonthlyUsd: number
  /**
   * Monthly price per host beyond `hostLimit` (AGL-68); null when the plan
   * cannot buy extra hosts.
   */
  extraHostMonthlyUsd: number | null
  /**
   * Monthly price per org-manager seat beyond `managersPerOrg`
   * (AGL-112); null when the plan cannot buy extra seats.
   */
  extraSeatMonthlyUsd: number | null
  /**
   * Monthly price per site-collaborator seat beyond `membersPerHost`
   * (AGL-112, renamed AGL-888): per-site console collaborators
   * (`hosts/{id}/members`, viewer/editor/admin) — never end-user member
   * accounts, which are unlimited on every plan. Null when the plan sells
   * no extra seats. Persisted/external keys keep the legacy "member"
   * spelling (`seatAddons.members`, `STRIPE_PRICE_*_EXTRA_MEMBER`).
   */
  extraCollaboratorMonthlyUsd: number | null
  /**
   * Monthly price per org dataset beyond `datasetsPerOrg` (AGL-132/240);
   * null when the plan cannot buy extra datasets.
   */
  extraDatasetMonthlyUsd: number | null
  /**
   * Metered overage per GB-month of dataset storage beyond
   * `dataStorageMbPerOrg` (AGL-240). Priced from Firestore storage cost
   * (~$0.18/GiB-mo) at roughly the platform's cost-plus posture; null
   * when the plan hard-blocks at the included size instead of metering.
   */
  extraDataGbMonthlyUsd: number | null
  /**
   * Metered overage per 1,000 customer REST API requests beyond
   * `apiRequestsPerMonth` (AGL-634). Only Business/Advanced carry API
   * access, so lower tiers are null (no API to meter).
   */
  extraApiRequestsUsdPer1k: number | null
  /**
   * Metered overage per 1,000 contacts beyond `contactsPerHost` (AGL-890):
   * audience bands, Ghost-style. Paid plans meter (a growing audience is
   * never dropped); free is null and hard-bands at the included count.
   */
  extraContactsUsdPer1k: number | null
  /**
   * Whether the plan carries the metered infrastructure pass-through
   * (AGL-41, turned on in AGL-1280): media storage, bandwidth (page views)
   * and form submissions BEYOND the plan's included bands, billed at
   * cost × `METERED_MARKUP`. The rates are platform-wide, not per-plan —
   * this flag only says whether a plan is subject to them at all, which is
   * why it is a boolean rather than another `extra*` rate.
   *
   * Free is `false` because there is no subscription to hang a metered item
   * on; its bands stay hard caps, which is also what stops "metered means
   * you're never cut off" from becoming unlimited free capacity.
   *
   * Enterprise is `false` because every band it has is `UNLIMITED` and its
   * price is negotiated (`isCustomPricedPlan`) — there is no published
   * pass-through to apply, and an overage can never arise anyway.
   */
  meteredInfraPassThrough: boolean
}

/**
 * Flat subscription pricing per tier (AGL-68). Kept beside the entitlements
 * so price changes ride the same review path; Stripe price ids map to plans
 * via `STRIPE_PRICE_*` env vars on the billing API routes.
 */
export const PLAN_PRICING: Record<OrgPlan, PlanPricing> = {
  free: {
    basePriceMonthlyUsd: 0,
    basePriceAnnualMonthlyUsd: 0,
    extraHostMonthlyUsd: null,
    extraSeatMonthlyUsd: null,
    extraCollaboratorMonthlyUsd: null,
    extraDatasetMonthlyUsd: null,
    extraDataGbMonthlyUsd: null,
    extraApiRequestsUsdPer1k: null,
    extraContactsUsdPer1k: null,
    meteredInfraPassThrough: false,
  },
  starter: {
    basePriceMonthlyUsd: 25,
    basePriceAnnualMonthlyUsd: 16,
    extraHostMonthlyUsd: 10,
    extraSeatMonthlyUsd: 5,
    extraCollaboratorMonthlyUsd: 3,
    extraDatasetMonthlyUsd: 2,
    extraDataGbMonthlyUsd: 0.25,
    extraApiRequestsUsdPer1k: null,
    extraContactsUsdPer1k: 1,
    meteredInfraPassThrough: true,
  },
  pro: {
    basePriceMonthlyUsd: 56,
    basePriceAnnualMonthlyUsd: 39,
    extraHostMonthlyUsd: 8,
    extraSeatMonthlyUsd: 4,
    extraCollaboratorMonthlyUsd: 2,
    extraDatasetMonthlyUsd: 2,
    extraDataGbMonthlyUsd: 0.25,
    extraApiRequestsUsdPer1k: null,
    extraContactsUsdPer1k: 0.75,
    meteredInfraPassThrough: true,
  },
  business: {
    basePriceMonthlyUsd: 139,
    basePriceAnnualMonthlyUsd: 99,
    extraHostMonthlyUsd: 5,
    extraSeatMonthlyUsd: 3,
    extraCollaboratorMonthlyUsd: 1,
    extraDatasetMonthlyUsd: 1,
    extraDataGbMonthlyUsd: 0.25,
    extraApiRequestsUsdPer1k: 0.5,
    extraContactsUsdPer1k: 0.5,
    meteredInfraPassThrough: true,
  },
  scale: {
    basePriceMonthlyUsd: 249,
    basePriceAnnualMonthlyUsd: 179,
    extraHostMonthlyUsd: 5,
    extraSeatMonthlyUsd: 2,
    extraCollaboratorMonthlyUsd: 1,
    extraDatasetMonthlyUsd: 1,
    extraDataGbMonthlyUsd: 0.25,
    extraApiRequestsUsdPer1k: 0.35,
    extraContactsUsdPer1k: 0.4,
    meteredInfraPassThrough: true,
  },
  advanced: {
    basePriceMonthlyUsd: 399,
    basePriceAnnualMonthlyUsd: 299,
    extraHostMonthlyUsd: 4,
    extraSeatMonthlyUsd: 2,
    extraCollaboratorMonthlyUsd: 1,
    extraDatasetMonthlyUsd: 1,
    extraDataGbMonthlyUsd: 0.25,
    extraApiRequestsUsdPer1k: 0.2,
    extraContactsUsdPer1k: 0.25,
    meteredInfraPassThrough: true,
  },
  agency: {
    basePriceMonthlyUsd: 799,
    basePriceAnnualMonthlyUsd: 649,
    extraHostMonthlyUsd: 3,
    extraSeatMonthlyUsd: 2,
    extraCollaboratorMonthlyUsd: 1,
    extraDatasetMonthlyUsd: 1,
    extraDataGbMonthlyUsd: 0.25,
    extraApiRequestsUsdPer1k: 0.15,
    extraContactsUsdPer1k: 0.2,
    meteredInfraPassThrough: true,
  },
  // Enterprise (AGL-1118) has NO list price — every figure here is the
  // "not for sale" sentinel, not a $0 offer (`isCustomPricedPlan`). The org's
  // real price is the negotiated `subscription.customMonthlyUsd` the
  // enterprise-billing flow writes (AGL-1110), which `orgListPriceMonthlyUsd`
  // already prefers over the plan default; a comped enterprise org genuinely
  // bills $0, and that is what this row then reports. Nulls also mean the
  // plan sells no self-serve add-on seats — enterprise capacity is unlimited,
  // so there is nothing to buy.
  enterprise: {
    basePriceMonthlyUsd: 0,
    basePriceAnnualMonthlyUsd: 0,
    extraHostMonthlyUsd: null,
    extraSeatMonthlyUsd: null,
    extraCollaboratorMonthlyUsd: null,
    extraDatasetMonthlyUsd: null,
    extraDataGbMonthlyUsd: null,
    extraApiRequestsUsdPer1k: null,
    extraContactsUsdPer1k: null,
    meteredInfraPassThrough: false,
  },
}

/**
 * Subscription states that stop paying for the plan (AGL-247). `past_due`
 * keeps working as a dunning grace period; these do not.
 */
const DEAD_SUBSCRIPTION_STATUSES = new Set(['canceled', 'unpaid', 'incomplete'])

/**
 * The subscription status entitlement resolution runs on (AGL-1028).
 *
 * `subscription` moved to `orgs/{orgId}/billing/stripe`, behind
 * `canManageOrg()` — but the status word is an ENTITLEMENT input, not a
 * commercial secret: `resolveEffectivePlan` downgrades a paid plan to free on a
 * dead subscription, and `resolvePurchasedAddons` stops counting add-ons on
 * one. Both resolve in the tenant runtime and in console components belonging
 * to members who cannot read a manager-gated doc, so the webhook mirrors the
 * bare status string back onto the org doc as `billingStatus`.
 *
 * Reads the mirror first, then the inline `subscription` — the fallback is what
 * keeps entitlements correct for orgs the backfill has not reached yet, and for
 * any caller still passing a whole billing doc rather than an org doc.
 */
function subscriptionStatusOf(
  org: Partial<AglynOrgBilling> | null | undefined,
): string | undefined {
  const mirrored = (org as { billingStatus?: unknown } | null | undefined)
    ?.billingStatus
  if (typeof mirrored === 'string' && mirrored) return mirrored
  return org?.subscription?.status
}

/**
 * Whether the org is actually being charged for its plan right now.
 *
 * This is deliberately stricter than `resolveEffectivePlan`: entitlement
 * asks "what does this org get", revenue asks "who is paying us". A staff
 * plan override (`/admin/orgs`) writes `plan` and never writes
 * `subscription`, so a comped or dark-launched org resolves to a paid plan
 * while billing nothing — counting it inflates MRR (AGL-925). No
 * subscription mirror means no Stripe subscription means no revenue.
 *
 * `past_due` counts: Stripe is still retrying and the plan is still owed.
 */
export function isBillingSubscription(
  org: Partial<AglynOrgBilling> | null | undefined,
): boolean {
  const plan = org?.plan
  if (!plan || plan === 'free' || !(plan in PLAN_ENTITLEMENTS)) return false
  const status = subscriptionStatusOf(org)
  if (!status) return false
  return !DEAD_SUBSCRIPTION_STATUSES.has(status)
}

/**
 * The org's monthly LIST price in USD — plan base plus every purchased add-on
 * (manager/collaborator seats, datasets, extra hosts, POS registers, Event
 * Calendar), BEFORE any applied discount, and 0 for anyone not actually
 * billing. This is the sticker price the plan + add-ons would bill at.
 *
 * Annual subscriptions contribute their per-month equivalent
 * (`basePriceAnnualMonthlyUsd`), not the month-to-month price, so a mixed
 * book does not read high by the size of the annual discount. Add-ons bill
 * per-month (annual variants are ×12 with no discount), so each contributes
 * its monthly price on either interval.
 *
 * Pricing-v3 fix (2026-07): previously omitted the host, POS-register, and
 * Event-Calendar add-ons, understating the total for every org carrying them.
 *
 * AGL-1105: split out of `orgMonthlyRevenueUsd`, which now subtracts an
 * applied per-org discount on top of this. Callers wanting the pre-discount
 * sticker (the margin guardrail, a "what would this bill at" quote) use this;
 * callers wanting the actual money collected use `orgMonthlyRevenueUsd`.
 */
export function orgListPriceMonthlyUsd(
  org: Partial<AglynOrgBilling> | null | undefined,
): number {
  if (!isBillingSubscription(org)) return 0
  // Custom enterprise price (AGL-1110): a negotiated amount is the list price
  // outright — it already reflects the whole deal, so it overrides the plan
  // default AND the seat/host add-on math (those are folded into the quote).
  // Stored monthly-normalized, so it is used as-is.
  const custom = org?.subscription?.customMonthlyUsd
  if (typeof custom === 'number' && custom > 0) {
    return Math.round(custom * 100) / 100
  }
  const pricing = PLAN_PRICING[org?.plan as OrgPlan]
  if (!pricing) return 0
  const annual = org?.subscription?.interval === 'year'
  const addons = org?.seatAddons ?? {}
  const seats = (quantity: number | undefined, price: number | null) =>
    Math.max(0, quantity ?? 0) * (price ?? 0)
  return (
    (annual ? pricing.basePriceAnnualMonthlyUsd : pricing.basePriceMonthlyUsd) +
    seats(addons.managers, pricing.extraSeatMonthlyUsd) +
    seats(addons.members, pricing.extraCollaboratorMonthlyUsd) +
    seats(addons.datasets, pricing.extraDatasetMonthlyUsd) +
    seats(addons.hosts, pricing.extraHostMonthlyUsd) +
    seats(addons.posRegisters, POS_REGISTER_ADDON_MONTHLY_USD) +
    seats(addons.eventCalendar, EVENT_CALENDAR_ADDON_MONTHLY_USD)
  )
}

/**
 * A list price net of a discount (AGL-1105). Percentage discounts scale the
 * whole bill; fixed discounts subtract a flat USD amount. Never below 0, and
 * a percentage is clamped to 0–100. Prefers `percentOff` when both are
 * somehow set (Stripe coupons carry only one). Rounds to whole cents.
 */
export function applyDiscountUsd(
  listPriceUsd: number,
  discount:
    | Pick<OrgDiscount, 'percentOff' | 'amountOffUsd'>
    | null
    | undefined,
): number {
  if (!(listPriceUsd > 0) || !discount) return Math.max(0, listPriceUsd)
  if (typeof discount.percentOff === 'number') {
    const pct = Math.min(100, Math.max(0, discount.percentOff))
    return Math.round(listPriceUsd * (1 - pct / 100) * 100) / 100
  }
  if (typeof discount.amountOffUsd === 'number') {
    return Math.max(0, Math.round((listPriceUsd - discount.amountOffUsd) * 100) / 100)
  }
  return listPriceUsd
}

/**
 * Whether an org should read as **"Enterprise"** everywhere the plan is shown.
 * Three ways to qualify:
 *  - **`plan === 'enterprise'`** — the real plan (AGL-1118). This is the path
 *    every new enterprise org takes, and the only one that also grants
 *    Enterprise *entitlements*; the two below are display-only overlays on a
 *    lower base plan;
 *  - a billing org on a **negotiated custom price** (`customMonthlyUsd > 0`) —
 *    a paying enterprise deal still parked on its pre-AGL-1118 base plan; or
 *  - an explicit **`org.enterprise`** marker — a *comped* enterprise account
 *    (full Enterprise capability + SSO, 100%-discounted so it collects $0,
 *    while infra cost is still metered).
 *
 * The last two are kept for orgs provisioned before `enterprise` was a plan;
 * migrating such an org to `plan: 'enterprise'` is the clean end state and
 * changes nothing about how it reads here. List-priced orgs with none of the
 * three are not enterprise.
 */
export function isEnterpriseOrg(
  org: Partial<AglynOrgBilling> | null | undefined,
): boolean {
  if (org?.plan === 'enterprise') return true
  if (org?.enterprise === true) return true
  return (
    isBillingSubscription(org) &&
    (org?.subscription?.customMonthlyUsd ?? 0) > 0
  )
}

/**
 * Human label shown for `enterprise` in plan badges. Kept as a named export
 * for the surfaces that label a custom-priced org whose stored `plan` is still
 * a lower tier; a real `plan: 'enterprise'` org gets the same string from
 * `PLAN_LABELS`.
 */
export const ENTERPRISE_PLAN_LABEL = PLAN_LABELS.enterprise

/**
 * The org's monthly recurring revenue in USD — its LIST price
 * (`orgListPriceMonthlyUsd`) net of any applied per-org discount
 * (`org.discount`, AGL-1105), and 0 for anyone who is not actually billing. A
 * comped enterprise deal genuinely collects less, so the discount belongs in
 * MRR; the pre-discount sticker stays available as `orgListPriceMonthlyUsd`.
 */
export function orgMonthlyRevenueUsd(
  org: Partial<AglynOrgBilling> | null | undefined,
): number {
  const listPrice = orgListPriceMonthlyUsd(org)
  if (listPrice <= 0) return 0
  return applyDiscountUsd(listPrice, org?.discount)
}

/**
 * Stripe's standard processing fee on Aglyn's OWN subscription charges
 * (AGL-1108) — 2.9% + $0.30 per charge. This is the fee Aglyn pays Stripe to
 * collect a subscription; it is DISTINCT from the storefront platform fee
 * (`transactionFee*Pct`, the Connect `application_fee`) that a seller's own
 * Stripe pays on their storefront sales. Revenue/margin should be reasoned on
 * the NET figure, not gross.
 */
export const STRIPE_PROCESSOR_FEE_PCT = 0.029
export const STRIPE_PROCESSOR_FEE_FIXED_USD = 0.3

/**
 * A gross monthly USD amount net of Stripe's processing fee. Annual
 * subscriptions are charged once per year, so the fixed 30¢ amortizes to
 * $0.30/12 per month; monthly subscriptions pay it every month. Never
 * returns below 0.
 */
export function netOfProcessorFee(
  grossMonthlyUsd: number,
  annual = false,
): number {
  if (!(grossMonthlyUsd > 0)) return 0
  const fixedPerMonth = annual
    ? STRIPE_PROCESSOR_FEE_FIXED_USD / 12
    : STRIPE_PROCESSOR_FEE_FIXED_USD
  const net = grossMonthlyUsd * (1 - STRIPE_PROCESSOR_FEE_PCT) - fixedPerMonth
  return Math.max(0, Math.round(net * 100) / 100)
}

/**
 * The org's monthly recurring revenue NET of Stripe's processing fee
 * (AGL-1108) — what Aglyn actually keeps before infra COGS, and the correct
 * base for margin/discount reasoning. Gross is `orgMonthlyRevenueUsd`; this
 * subtracts ~2.9%+30¢, interval-aware. 0 for anyone not actually billing.
 */
export function orgNetMonthlyRevenueUsd(
  org: Partial<AglynOrgBilling> | null | undefined,
): number {
  const gross = orgMonthlyRevenueUsd(org)
  if (gross <= 0) return 0
  return netOfProcessorFee(gross, org?.subscription?.interval === 'year')
}

/**
 * Net-margin floor for discount underwriting (AGL-1105). Mirrors the
 * Enterprise-Pricing-Calculator's ~75% gross-margin target: a discounted
 * subscription should still keep ≥75% of its net (post-processor-fee) revenue
 * after infrastructure COGS. Below the floor a discount is warned; well below
 * it is blocked without explicit sign-off.
 */
export const NET_MARGIN_FLOOR_PCT = 0.75

/**
 * How far under the floor a discount may sit and still only WARN (AGL-1105).
 * Within `[floor − band, floor)` staff see a caution; below `floor − band`
 * the guardrail blocks unless overridden. 10 points, matching the
 * calculator's soft/hard split.
 */
export const NET_MARGIN_WARN_BAND_PCT = 0.1

/**
 * Per-site monthly infrastructure COGS in USD (AGL-1105). The
 * Enterprise-Pricing-Calculator's ~$2/site figure — Firebase + Vercel at
 * cost — charged against every host the org runs. The margin guardrail
 * subtracts this from net revenue before rating a discount.
 */
export const INFRA_COGS_PER_SITE_USD = 2

/**
 * Monthly unit costs for the meters the rollup already records (AGL-1134).
 *
 * These are OUR costs, not prices — the org is billed at cost × 1.30
 * (`METERED_MARKUP`, AGL-41). Storage/page-view/form rates match
 * `METERED_UNIT_RATES_USD` in the metering module on purpose: two files
 * disagreeing about what a page view costs is exactly the drift this function
 * exists to remove.
 *
 * The three added here are operator-tuned estimates of the same quality as
 * the existing three — Firestore-backed dataset storage is priced well above
 * object storage because it is, and API requests and contacts are priced off
 * the reads behind them. Treat all six as provisional until validated against
 * a real Firebase + Vercel invoice month; AGL-1134 says so out loud rather
 * than implying the numbers are derived.
 *
 * The first three were corrected 2026-08-09 (AGL-1280) — storage $0.03 →
 * $0.026 and form submissions $0.0005 → $0.00005 — and MUST be changed here
 * and in `METERED_UNIT_RATES_USD` together. See that table for each figure's
 * basis; it is the one a customer is billed against, so it is the one that
 * carries the working. Lowering the two here lowers measured COGS, which
 * changes no guardrail verdict: `INFRA_COGS_PER_SITE_USD × sites` is the
 * floor, and it already outran measured cost by five orders of magnitude.
 */
export const ORG_COGS_UNIT_RATES_USD = {
  storagePerGbMonth: 0.026,
  perPageView: 0.0001,
  perFormSubmission: 0.00005,
  /** Firestore-backed dataset bytes — an order pricier than object storage. */
  dataStoragePerGbMonth: 0.18,
  perApiRequest: 0.000002,
  perContactMonth: 0.0002,
}

/** The rollup fields `orgMonthlyCogsUsd` prices. All optional and all absent-safe. */
export interface OrgUsageRollupInput {
  hostCount?: number | null
  storageGb?: number | null
  pageViews?: number | null
  formSubmissions?: number | null
  dataStorageMb?: number | null
  apiRequests?: number | null
  contactsCount?: number | null
}

export interface OrgCogsResult {
  /** What the guardrail should charge against revenue. */
  cogsUsd: number
  /** Which arm produced it — `floor` means the meters came in under the flat estimate. */
  basis: 'measured' | 'floor'
  /** Cost from the meters alone, before the floor is applied. */
  measuredUsd: number
  /** `INFRA_COGS_PER_SITE_USD` × sites. */
  floorUsd: number
  /** Per-meter contributions, for showing the working in staff UI. */
  breakdown: Record<string, number>
}

/**
 * One org's monthly infrastructure COGS — the single cost model (AGL-1134).
 *
 * Replaces two things that had drifted apart: the discount guardrail read the
 * rollup's `costUsd`, and the staff MRR views read the same field separately,
 * so neither could be changed without silently changing the other's meaning.
 *
 * `costUsd` was also incomplete. The rollup records `dataStorageMb`,
 * `apiRequests` and `contactsCount`, and `estimateMonthlyUsageCost` prices
 * none of them — it sums storage, page views and form submissions only. So
 * the "measured" cost omitted three meters the platform was already at the
 * trouble of recording.
 *
 * The flat per-site figure stays a FLOOR rather than a fallback: measured
 * cost wins only when it exceeds the estimate. A rollup that has not run, or
 * an org with genuinely tiny usage, must not make the guardrail more generous
 * — that is the one direction that costs money.
 *
 * Measured against production 2026-07-30, that floor is doing all the work:
 * the largest real org's `costUsd` was **$0.0000054** against a $4.00 floor
 * for two sites. Five orders of magnitude. So this function changes no verdict
 * today, and will not until there is real traffic — which is the honest
 * reason to build it now, while nothing depends on the answer.
 */
export function orgMonthlyCogsUsd(
  rollup: OrgUsageRollupInput | null | undefined,
  siteCount: number,
): OrgCogsResult {
  const num = (value: unknown) => {
    const parsed = Number(value ?? 0)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }
  const rates = ORG_COGS_UNIT_RATES_USD
  const breakdown = {
    storage: num(rollup?.storageGb) * rates.storagePerGbMonth,
    pageViews: num(rollup?.pageViews) * rates.perPageView,
    formSubmissions: num(rollup?.formSubmissions) * rates.perFormSubmission,
    // Megabytes on the doc, gigabytes in the rate — the unit mismatch is in
    // the stored field name, so convert here rather than in each caller.
    dataStorage: (num(rollup?.dataStorageMb) / 1024) * rates.dataStoragePerGbMonth,
    apiRequests: num(rollup?.apiRequests) * rates.perApiRequest,
    contacts: num(rollup?.contactsCount) * rates.perContactMonth,
  }
  const measuredUsd = Object.values(breakdown).reduce((sum, x) => sum + x, 0)
  const floorUsd = Math.max(0, siteCount) * INFRA_COGS_PER_SITE_USD
  return {
    cogsUsd: Math.max(measuredUsd, floorUsd),
    basis: measuredUsd > floorUsd ? 'measured' : 'floor',
    measuredUsd,
    floorUsd,
    breakdown,
  }
}

/**
 * Pluck the fields `orgMonthlyCogsUsd` prices out of a raw usage rollup
 * (AGL-1134) — a Firestore `snapshot.data()`, or the JSON a staff endpoint
 * served from one. ONE list of field names, in one place.
 *
 * The hazard this closes is silent. Every caller previously hand-listed the
 * six fields at its own call site — the discount route, the anomaly detector,
 * the staff org page — and `/api/admin/org-usage` projected only three of
 * them. A projection that drops a priced field does not error; the model just
 * returns a smaller number, and a smaller COGS is the direction that APPROVES
 * a discount. Same shape as the API projection that starved a predicate in
 * AGL-1355, and the two-units usage figure that read 20-45% wrong for years
 * in AGL-1402.
 *
 * UNITS, because the field names do not all say: `storageGb` and
 * `dataStorageMb` are gigabytes and MEGABYTES respectively (the conversion
 * lives in `orgMonthlyCogsUsd`, with its own test); `pageViews`,
 * `formSubmissions` and `apiRequests` are counts FOR THE MONTH;
 * `contactsCount` is a point-in-time headcount, not a monthly flow.
 */
export function orgCogsInputFrom(
  source: Record<string, unknown> | null | undefined,
): OrgUsageRollupInput {
  const read = (field: string) => {
    const value = source?.[field]
    return value == null ? undefined : (value as number)
  }
  return {
    hostCount: read('hostCount'),
    storageGb: read('storageGb'),
    pageViews: read('pageViews'),
    formSubmissions: read('formSubmissions'),
    dataStorageMb: read('dataStorageMb'),
    apiRequests: read('apiRequests'),
    contactsCount: read('contactsCount'),
  }
}

/**
 * A cost figure, or the explicit admission that the rollup has not loaded
 * (AGL-1134).
 *
 * `pending` is not "no usage" and not "$0" — it is "do not answer yet".
 */
export type OrgCogsPreview =
  | { status: 'pending' }
  | { status: 'ready'; cogs: OrgCogsResult }

/**
 * `orgMonthlyCogsUsd` behind an explicit readiness flag (AGL-1134).
 *
 * The staff org page loads its rollup asynchronously, and an unfinished read
 * and an absent document are the same `undefined`. Priced directly, both
 * yield `basis: 'floor'` — so the enterprise pricing card printed "per-site
 * floor — no usage recorded yet" during the loading window, a
 * measurement-shaped sentence about an org whose measurements had simply not
 * arrived. That is the AGL-1380 / AGL-1422 defect exactly: a question
 * answered before its data is ready, and answered in the cheap direction.
 *
 * Returning a discriminated union rather than a nullable number is what makes
 * the window unrepresentable — a caller cannot reach a cost without first
 * handling `pending`, so the next call site cannot re-introduce this by
 * forgetting a flag it was handed.
 */
export function orgCogsPreview(
  ready: boolean,
  rollup: OrgUsageRollupInput | null | undefined,
  siteCount: number,
): OrgCogsPreview {
  // Gated on the caller's flag alone. Deriving readiness from `rollup` being
  // truthy would re-create the bug: the org with no rollup yet is precisely
  // the one whose value stays falsy after the read completes.
  if (!ready) return { status: 'pending' }
  return { status: 'ready', cogs: orgMonthlyCogsUsd(rollup, siteCount) }
}

/**
 * Percent-off at or above which creating a coupon needs explicit staff
 * sign-off (AGL-1105). A ≥40%-off coupon is a real revenue commitment, so the
 * creation route rejects it unless the caller passes a confirm flag; the UI
 * surfaces a checkbox at this threshold.
 */
export const DISCOUNT_APPROVAL_THRESHOLD_PCT = 40

/**
 * Discount DEPTH bands (AGL-1120) — how much of list price is being given
 * away, which is a different question from whether the remainder covers
 * infrastructure.
 *
 * The original guardrail asked only the second question, so a **93% off**
 * coupon rated "OK — net margin 78.1% vs a 75% floor": $9.15 left against $2
 * of infra really is a 78% contribution margin. The ratio is scale-invariant,
 * so as long as the leftover dwarfs $2 the verdict stays green no matter how
 * little is left. Depth never entered the verdict at all.
 *
 * Warn at the threshold that already requires sign-off, so the badge and the
 * approval checkbox stop disagreeing with each other; block at 70%, where a
 * deal is being given away rather than discounted.
 */
export const DISCOUNT_DEPTH_WARN_PCT = DISCOUNT_APPROVAL_THRESHOLD_PCT
export const DISCOUNT_DEPTH_BLOCK_PCT = 70

/** How many sites (hosts) the org runs — at least 1 for a billing org. */
export function orgSiteCount(
  org: Partial<AglynOrgBilling> | null | undefined,
): number {
  return Math.max(1, Object.keys(org?.hosts ?? {}).length)
}

/** The margin-guardrail verdict for a proposed or applied discount. */
export type DiscountMarginRating = 'ok' | 'warn' | 'block'

export interface DiscountMarginResult {
  /** Pre-discount list price (`orgListPriceMonthlyUsd`). */
  grossUsd: number
  /** List price net of the proposed discount. */
  discountedUsd: number
  /** Discounted price net of Stripe's processing fee — what Aglyn keeps. */
  netUsd: number
  /**
   * Monthly COGS charged against this org: the org's MEASURED cost when the
   * caller supplies one, else the flat `$/site × sites` estimate. The flat
   * figure is a floor, never a ceiling — a measured cost below it is treated
   * as the estimate, since a rollup that has not caught up must not make a
   * deal look cheaper than the placeholder did.
   */
  infraCogsUsd: number
  /** True when `infraCogsUsd` came from measured usage, not the flat rate. */
  cogsMeasured: boolean
  /**
   * Cost recovery = (net − COGS) / net, as a fraction. 1 = COGS-free; -1 is
   * the clamp for a fully-underwater discount (net ≤ 0), which always blocks.
   *
   * NOT a deal-quality number on its own — see `depthPct`. Kept under its
   * original name because the staff UI reports it verbatim.
   */
  marginPct: number
  /** Share of list price given away, as a fraction (0.93 = 93% off). */
  depthPct: number
  /** The worse of the depth and cost-recovery verdicts. */
  rating: DiscountMarginRating
  /**
   * Which test produced `rating`, so the UI can say why rather than showing a
   * margin number that looks fine next to a red badge.
   */
  reason: 'none' | 'depth' | 'cogs' | 'underwater'
  /** The cost-recovery floor this was rated against (`NET_MARGIN_FLOOR_PCT`). */
  floorPct: number
}

export interface DiscountMarginOptions {
  /**
   * The org's measured monthly cost, when the caller has it — the `costUsd`
   * rollup at `orgs/{id}/usage/{month}`. Server callers and the staff org
   * page can supply it; coupon creation cannot, because no org is chosen yet.
   */
  measuredCogsUsd?: number | null
}

/**
 * Rate a proposed discount (AGL-1105, re-shaped in AGL-1120) — the guardrail
 * behind staff coupon creation and per-org application.
 *
 * Two independent questions, and the verdict is the WORSE of them:
 *
 *  1. **How deep is it?** `depthPct` against `DISCOUNT_DEPTH_WARN_PCT` /
 *     `DISCOUNT_DEPTH_BLOCK_PCT`. This is the one that was missing. Cost
 *     recovery alone is scale-invariant — 93% off $139 leaves $9.15 against
 *     $2 of infra, a genuine 78% contribution margin — so the old verdict
 *     rated a give-away "OK" and only warned at 94%.
 *  2. **Does the remainder cover the cost of serving them?** `marginPct`
 *     against `NET_MARGIN_FLOOR_PCT`, with `NET_MARGIN_WARN_BAND_PCT` below
 *     it, and an automatic block once the discount drives net ≤ 0.
 *
 * Neither subsumes the other: a shallow discount on an org running twenty
 * sites can still fail cost recovery, and a deep one on a cheap org can still
 * clear it. `reason` reports which test bound, so the UI never shows a
 * healthy-looking margin beside a red badge without explanation.
 *
 * `discount` is the PROPOSED change, independent of any discount already on
 * the org — `grossUsd` is always the list price (`orgListPriceMonthlyUsd`),
 * so this never double-counts an existing `org.discount`. A non-billing org
 * (list price 0) has no revenue to protect and rates `ok`.
 */
export function checkDiscountMargin(
  org: Partial<AglynOrgBilling> | null | undefined,
  discount: Pick<OrgDiscount, 'percentOff' | 'amountOffUsd'>,
  options: DiscountMarginOptions = {},
): DiscountMarginResult {
  const floorPct = NET_MARGIN_FLOOR_PCT
  const grossUsd = orgListPriceMonthlyUsd(org)
  const flatCogsUsd =
    Math.round(INFRA_COGS_PER_SITE_USD * orgSiteCount(org) * 100) / 100
  // Measured cost wins only when it EXCEEDS the flat estimate. A rollup that
  // has not run yet reads as a low number, and a guardrail that got looser
  // because the meter was behind would fail in the one direction that costs
  // money.
  const measured = Number(options.measuredCogsUsd ?? 0)
  const cogsMeasured = Number.isFinite(measured) && measured > flatCogsUsd
  const infraCogsUsd = cogsMeasured
    ? Math.round(measured * 100) / 100
    : flatCogsUsd
  if (grossUsd <= 0) {
    return {
      grossUsd: 0,
      discountedUsd: 0,
      netUsd: 0,
      infraCogsUsd,
      cogsMeasured,
      marginPct: 1,
      depthPct: 0,
      rating: 'ok',
      reason: 'none',
      floorPct,
    }
  }
  const discountedUsd = applyDiscountUsd(grossUsd, discount)
  const annual = org?.subscription?.interval === 'year'
  const netUsd = netOfProcessorFee(discountedUsd, annual)
  const depthPct =
    Math.round(((grossUsd - discountedUsd) / grossUsd) * 10000) / 10000
  const marginPct =
    netUsd > 0
      ? Math.round(((netUsd - infraCogsUsd) / netUsd) * 10000) / 10000
      : -1

  const depthRating: DiscountMarginRating =
    depthPct * 100 >= DISCOUNT_DEPTH_BLOCK_PCT
      ? 'block'
      : depthPct * 100 >= DISCOUNT_DEPTH_WARN_PCT
        ? 'warn'
        : 'ok'
  const cogsRating: DiscountMarginRating =
    marginPct >= floorPct
      ? 'ok'
      : marginPct >= floorPct - NET_MARGIN_WARN_BAND_PCT
        ? 'warn'
        : 'block'

  const severity = { ok: 0, warn: 1, block: 2 } as const
  const rating =
    severity[depthRating] >= severity[cogsRating] ? depthRating : cogsRating
  const reason: DiscountMarginResult['reason'] =
    rating === 'ok'
      ? 'none'
      : netUsd <= 0
        ? 'underwater'
        : severity[depthRating] >= severity[cogsRating]
          ? 'depth'
          : 'cogs'

  return {
    grossUsd,
    discountedUsd,
    netUsd,
    infraCogsUsd,
    cogsMeasured,
    marginPct,
    depthPct,
    rating,
    reason,
    floorPct,
  }
}

/**
 * The plan the org actually gets (AGL-247): missing/unknown plans resolve
 * as `free`, and a paid plan whose subscription is canceled/unpaid/
 * incomplete downgrades to `free` until the webhook restores it — plan
 * fields alone are not entitlement.
 */
export function resolveEffectivePlan(
  org: Partial<AglynOrgBilling> | null | undefined,
): OrgPlan {
  const plan = org?.plan
  if (!plan || !(plan in PLAN_ENTITLEMENTS)) return 'free'
  const status = subscriptionStatusOf(org)
  if (plan !== 'free' && status && DEAD_SUBSCRIPTION_STATUSES.has(status)) {
    return 'free'
  }
  return plan
}

function resolvePlan(org: Partial<AglynOrgBilling> | null | undefined) {
  return resolveEffectivePlan(org)
}

/**
 * Purchased add-on quantities that currently apply (AGL-524): add-ons
 * bill as items on the org's Stripe subscription, so a dead subscription
 * (the `resolveEffectivePlan` set) stops them counting until the webhook
 * restores it. Orgs with no subscription state keep staff-set quantities
 * (comped add-ons predating self-serve billing).
 */
function resolvePurchasedAddons(
  org: Partial<AglynOrgBilling> | null | undefined,
): OrgSeatAddons {
  const status = subscriptionStatusOf(org)
  if (status && DEAD_SUBSCRIPTION_STATUSES.has(status)) return {}
  return org?.seatAddons ?? {}
}

/**
 * Effective entitlements for an org: plan defaults with the org doc's
 * per-key overrides applied (features merge key-by-key too), then
 * purchased add-ons stacked on top (AGL-524): `seatAddons.hosts` raises
 * `hostLimit`, `seatAddons.posRegisters` raises `posRegisters`, and
 * `seatAddons.eventCalendar` switches the `eventCalendar` feature on.
 * (Seat/dataset add-ons instead fold in at `checkSeatQuota` /
 * `checkDatasetQuota`, where the per-plan hard max clamps them.)
 * Missing or unknown plans resolve as `free`.
 */
export function resolveOrgEntitlements(
  org: Partial<AglynOrgBilling> | null | undefined,
): ResolvedOrgEntitlements {
  const defaults = PLAN_ENTITLEMENTS[resolvePlan(org)]
  const overrides = org?.entitlements
  let resolved = defaults
  if (overrides) {
    const {
      features: featureOverrides,
      datasetsPerHost: legacyDatasets,
      maxDatasetsPerHost: legacyMaxDatasets,
      ...quotaOverrides
    } = overrides
    const merged = { ...defaults }
    for (const [key, value] of Object.entries(quotaOverrides)) {
      if (typeof value === 'number') (merged as any)[key] = value
    }
    // Pre-AGL-240 override docs keyed datasets per host; resolve them into
    // the org keys unless an org-keyed override is present.
    if (typeof legacyDatasets === 'number' && overrides.datasetsPerOrg == null) {
      merged.datasetsPerOrg = legacyDatasets
    }
    if (
      typeof legacyMaxDatasets === 'number' &&
      overrides.maxDatasetsPerOrg == null
    ) {
      merged.maxDatasetsPerOrg = legacyMaxDatasets
    }
    resolved = {
      ...merged,
      features: { ...defaults.features, ...featureOverrides },
    }
  }
  const purchased = resolvePurchasedAddons(org)
  const extraHosts = Math.max(0, purchased.hosts ?? 0)
  const extraRegisters = Math.max(0, purchased.posRegisters ?? 0)
  const eventCalendar = (purchased.eventCalendar ?? 0) >= 1
  if (!extraHosts && !extraRegisters && !eventCalendar) return resolved
  return {
    ...resolved,
    hostLimit: resolved.hostLimit + extraHosts,
    posRegisters: resolved.posRegisters + extraRegisters,
    features: eventCalendar
      ? { ...resolved.features, eventCalendar: true }
      : resolved.features,
  }
}

/**
 * Platform transaction fee % for a storefront sale (AGL-278): resolved
 * from the effective plan (with per-org overrides) by product type.
 * Digital and service sales use the digital rate; AGL-307 turns this into
 * the Stripe Connect `application_fee_amount` at charge time.
 */
export function resolveTransactionFeePct(
  org: Partial<AglynOrgBilling> | null | undefined,
  productType: 'physical' | 'digital' | 'service',
): number {
  const entitlements = resolveOrgEntitlements(org)
  const pct =
    productType === 'physical'
      ? entitlements.transactionFeePhysicalPct
      : entitlements.transactionFeeDigitalPct
  return Number.isFinite(pct) && pct > 0 ? pct : 0
}

/** True when the org's plan (or overrides) enables the boolean feature. */
export function checkEntitlement(
  org: Partial<AglynOrgBilling> | null | undefined,
  feature: keyof OrgFeatureFlags,
): boolean {
  return Boolean(resolveOrgEntitlements(org).features[feature])
}

/**
 * A branding profile with every field present — what a branded surface
 * renders. Image/color/domain fields are nullable (Aglyn's own surfaces
 * bake those in rather than carry a URL); the text fields always have a
 * value so callers never string-concatenate `undefined`.
 */
export interface ResolvedBrandingProfile {
  productName: string
  logoUrl: string | null
  faviconUrl: string | null
  primaryColor: string | null
  supportUrl: string
  fromName: string
  emailLogoUrl: string | null
  customConsoleDomain: string | null
}

/**
 * The Aglyn (non-white-label) brand — the fallback every surface gets when
 * an org lacks the `whiteLabel` entitlement, and the gap-filler for a
 * partial agency profile. Kept here beside the entitlement so brand and
 * gate stay reviewed together.
 */
export const AGLYN_BRANDING_PROFILE: ResolvedBrandingProfile = {
  productName: 'Aglyn',
  logoUrl: null,
  faviconUrl: null,
  primaryColor: null,
  supportUrl: 'https://aglyn.com/support',
  fromName: 'Aglyn',
  emailLogoUrl: null,
  customConsoleDomain: null,
}

/** A non-empty trimmed string, else undefined — blanks never override a default. */
function cleanBrandString(value: string | undefined): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length ? trimmed : undefined
}

/**
 * The effective brand for an org (White-Label Phase 1). EVERY branded
 * surface — published-site branding, transactional email, console chrome —
 * MUST read the brand through this one resolver so a white-label org can
 * never partly-render as Aglyn (the multi-surface drift that dogged
 * `removeBranding`, which each surface re-derived on its own).
 *
 * When the org carries the `whiteLabel` entitlement (Agency tier, or an
 * Enterprise per-org override), the org's `brandingProfile` values win and
 * any field it leaves blank falls back to the Aglyn default. Without the
 * entitlement the stored profile is ignored entirely and the full Aglyn
 * brand is returned — so an org that white-labeled and then downgraded
 * reverts cleanly.
 */
export function resolveBrandingProfile(
  org: Partial<AglynOrgBilling> | null | undefined,
): ResolvedBrandingProfile {
  if (!checkEntitlement(org, 'whiteLabel')) return AGLYN_BRANDING_PROFILE
  const profile = (org?.brandingProfile ?? {}) as OrgBrandingProfile
  return {
    productName:
      cleanBrandString(profile.productName) ??
      AGLYN_BRANDING_PROFILE.productName,
    logoUrl: cleanBrandString(profile.logoUrl) ?? AGLYN_BRANDING_PROFILE.logoUrl,
    faviconUrl:
      cleanBrandString(profile.faviconUrl) ?? AGLYN_BRANDING_PROFILE.faviconUrl,
    primaryColor:
      cleanBrandString(profile.primaryColor) ??
      AGLYN_BRANDING_PROFILE.primaryColor,
    supportUrl:
      cleanBrandString(profile.supportUrl) ?? AGLYN_BRANDING_PROFILE.supportUrl,
    fromName:
      cleanBrandString(profile.fromName) ?? AGLYN_BRANDING_PROFILE.fromName,
    emailLogoUrl:
      cleanBrandString(profile.emailLogoUrl) ??
      AGLYN_BRANDING_PROFILE.emailLogoUrl,
    customConsoleDomain:
      cleanBrandString(profile.customConsoleDomain) ??
      AGLYN_BRANDING_PROFILE.customConsoleDomain,
  }
}

/**
 * Whether the org has actually **configured** a white-label brand (AGL-1110) —
 * a non-empty product name or logo. White-label chrome should activate only
 * when this is true, not merely because the plan grants the `whiteLabel`
 * entitlement: an Agency org (or a comped Enterprise org) that never set up a
 * brand keeps the plain Aglyn wordmark — no product-name-text render, no
 * flash — until it opts in on the branding page.
 */
export function hasBrandingProfile(
  org: Partial<AglynOrgBilling> | null | undefined,
): boolean {
  const profile = org?.brandingProfile
  if (!profile) return false
  return !!(
    cleanBrandString(profile.productName) || cleanBrandString(profile.logoUrl)
  )
}

/**
 * Quota check: `allowed` is false once `currentUsage` meets the limit —
 * call before creating the next resource (e.g. usage=hostCount before
 * creating another host). `remaining` never goes negative.
 */
/**
 * `members` = per-site collaborator seats (legacy key, AGL-888): the key
 * matches persisted `seatAddons.members` and must not be renamed.
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
 * Seat quota check (AGL-112): seats differ from plain quotas because orgs
 * can buy addon seats (`org.seatAddons`) up to a per-plan hard max —
 * beyond the max the only path is upgrading the plan. `managers` counts
 * org-manager seats org-wide; `members` counts per-site COLLABORATORS
 * (`hosts/{id}/members`, viewer/editor/admin — legacy key name, AGL-888).
 * End-user member accounts (`siteMembers`) are unlimited and never pass
 * through here.
 */
export function checkSeatQuota(
  org: Partial<AglynOrgBilling> | null | undefined,
  kind: SeatKind,
  currentUsage: number,
): SeatQuotaResult {
  const entitlements = resolveOrgEntitlements(org)
  const pricing = PLAN_PRICING[resolvePlan(org)]
  const included =
    kind === 'managers'
      ? entitlements.managersPerOrg
      : entitlements.membersPerHost
  const maxSeats =
    kind === 'managers'
      ? entitlements.maxManagersPerOrg
      : entitlements.maxMembersPerHost
  const addonPriceUsd =
    kind === 'managers'
      ? pricing.extraSeatMonthlyUsd
      : pricing.extraCollaboratorMonthlyUsd
  const purchased = Math.max(0, resolvePurchasedAddons(org)[kind] ?? 0)
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
  org: Partial<AglynOrgBilling> | null | undefined,
  quota: keyof Omit<ResolvedOrgEntitlements, 'features'>,
  currentUsage: number,
): { allowed: boolean; limit: number; remaining: number } {
  const limit = resolveOrgEntitlements(org)[quota]
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
 * Dataset quota check (AGL-132/240), mirroring `checkSeatQuota`: orgs can
 * buy addon datasets (`org.seatAddons.datasets`, org-wide) up to the
 * plan's hard max; beyond the max the only path is upgrading.
 */
export function checkDatasetQuota(
  org: Partial<AglynOrgBilling> | null | undefined,
  currentUsage: number,
): DatasetQuotaResult {
  const entitlements = resolveOrgEntitlements(org)
  const pricing = PLAN_PRICING[resolvePlan(org)]
  const included = entitlements.datasetsPerOrg
  const maxDatasets = entitlements.maxDatasetsPerOrg
  const addonPriceUsd = pricing.extraDatasetMonthlyUsd
  const purchased = Math.max(0, resolvePurchasedAddons(org).datasets ?? 0)
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

export interface DataStorageQuotaResult {
  /**
   * False only when the plan hard-blocks (no overage pricing) and usage
   * meets the included size; metered plans always allow and bill overage.
   */
  allowed: boolean
  /** Included dataset storage on the plan, MB. */
  includedMb: number
  usedMb: number
  /** Remaining included storage, MB; 0 once into overage. */
  remainingMb: number
  /** Usage beyond the included size, GB (0 when within the plan). */
  overageGb: number
  /** Estimated overage this month at the plan's per-GB rate. */
  overageMonthlyUsd: number
  /** Per-GB-month overage rate; null when the plan meters nothing. */
  overageRateUsd: number | null
}

/**
 * Org dataset-storage meter (AGL-240): aggregate stored document bytes
 * across `orgs/{orgId}/datasets`. Plans with an `extraDataGbMonthlyUsd`
 * rate meter the overage onto the monthly invoice (cost-plus, AGL-41);
 * plans without one (free) hard-block at the included size.
 */
export function checkDataStorageQuota(
  org: Partial<AglynOrgBilling> | null | undefined,
  usedMb: number,
): DataStorageQuotaResult {
  const entitlements = resolveOrgEntitlements(org)
  const pricing = PLAN_PRICING[resolvePlan(org)]
  const includedMb = entitlements.dataStorageMbPerOrg
  const overageRateUsd = pricing.extraDataGbMonthlyUsd
  const used = Math.max(0, usedMb)
  const overageMb = Math.max(0, used - includedMb)
  const overageGb = overageMb / 1024
  return {
    allowed: overageRateUsd !== null ? true : used < includedMb,
    includedMb,
    usedMb: used,
    remainingMb: Math.max(0, includedMb - used),
    overageGb,
    overageMonthlyUsd:
      overageRateUsd === null
        ? 0
        : Math.round(overageGb * overageRateUsd * 100) / 100,
    overageRateUsd,
  }
}

export interface ApiRequestQuotaResult {
  /** Metered plans always allow; plans without API access block. */
  allowed: boolean
  /** Included requests this month at the plan. */
  included: number
  used: number
  /** Remaining included requests; 0 once into overage. */
  remaining: number
  /** Requests beyond the included quota (0 within the plan). */
  overageRequests: number
  /** Estimated overage this month at the plan's per-1,000 rate. */
  overageMonthlyUsd: number
  /** Per-1,000 overage rate; null when the plan has no API. */
  overageRateUsd: number | null
}

/**
 * Customer REST API request meter (AGL-634): the monthly request count for an
 * org. Business/Advanced carry `apiAccess` and an `extraApiRequestsUsdPer1k`
 * rate, so requests past the included quota meter onto the monthly invoice
 * (cost-plus, like storage overage — never a hard wall mid-integration); plans
 * without API access have `included: 0` and always block.
 */
export function checkApiRequestQuota(
  org: Partial<AglynOrgBilling> | null | undefined,
  usedRequests: number,
): ApiRequestQuotaResult {
  const entitlements = resolveOrgEntitlements(org)
  const pricing = PLAN_PRICING[resolvePlan(org)]
  const included = entitlements.apiRequestsPerMonth
  const overageRateUsd = pricing.extraApiRequestsUsdPer1k
  const used = Math.max(0, usedRequests)
  const overageRequests = Math.max(0, used - included)
  return {
    allowed: overageRateUsd !== null ? true : used < included,
    included,
    used,
    remaining: Math.max(0, included - used),
    overageRequests,
    overageMonthlyUsd:
      overageRateUsd === null
        ? 0
        : Math.round((overageRequests / 1000) * overageRateUsd * 100) / 100,
    overageRateUsd,
  }
}

export interface ContactQuotaResult {
  /** Metered plans always allow; free hard-bands at the included count. */
  allowed: boolean
  /** Included contacts on the plan (the audience band). */
  included: number
  used: number
  /** Remaining included contacts; 0 once into overage. */
  remaining: number
  /** Contacts beyond the included band (0 within the plan). */
  overageContacts: number
  /** Estimated overage this month at the plan's per-1,000 rate. */
  overageMonthlyUsd: number
  /** Per-1,000 overage rate; null when the plan hard-bands (free). */
  overageRateUsd: number | null
}

/**
 * Contacts audience-band meter (AGL-890): contacts are the CRM projection
 * of a site's audience (signups, form fills, buyers), stored org-wide.
 * Paid plans carry an `extraContactsUsdPer1k` rate, so contacts past the
 * included band meter onto the monthly invoice (cost-plus, like storage
 * and API overage — a growing audience is never dropped); free has no
 * rate and hard-bands at the included count. End-user member ACCOUNTS are
 * unlimited on every plan (AGL-889) — this meters only the CRM record.
 */
export function checkContactQuota(
  org: Partial<AglynOrgBilling> | null | undefined,
  usedContacts: number,
): ContactQuotaResult {
  const entitlements = resolveOrgEntitlements(org)
  const pricing = PLAN_PRICING[resolvePlan(org)]
  const included = entitlements.contactsPerHost
  const overageRateUsd = pricing.extraContactsUsdPer1k
  const used = Math.max(0, usedContacts)
  const overageContacts = Math.max(0, used - included)
  return {
    allowed: overageRateUsd !== null ? true : used < included,
    included,
    used,
    remaining: Math.max(0, included - used),
    overageContacts,
    overageMonthlyUsd:
      overageRateUsd === null
        ? 0
        : Math.round((overageContacts / 1000) * overageRateUsd * 100) / 100,
    overageRateUsd,
  }
}

/**
 * Is this org's plan subject to the metered infrastructure pass-through
 * (AGL-1280)? The single answer behind three otherwise-unrelated behaviours:
 * whether storage/bandwidth/form usage past the included band is BILLED, and
 * whether the form-submission cap is a wall or a meter.
 *
 * Deliberately a plan-level question, not an org-level one — an org with no
 * plan resolves as free, so an unknown org meters nothing. Billing usage to
 * someone with no subscription is the one error direction with no recovery.
 */
export function planMetersInfraOverage(
  org: Partial<AglynOrgBilling> | null | undefined,
): boolean {
  return PLAN_PRICING[resolvePlan(org)].meteredInfraPassThrough
}

export interface FormSubmissionQuotaResult {
  /**
   * False only when the plan hard-caps (no metered pass-through) and usage
   * has reached the included count; metered plans always accept and bill
   * the excess.
   */
  allowed: boolean
  /** Included submissions this month for this site. */
  included: number
  used: number
  /** Remaining included submissions; 0 once into overage. */
  remaining: number
  /** Submissions beyond the included count (0 within the plan). */
  overageSubmissions: number
  /** True when overage meters instead of blocking. */
  metered: boolean
}

/**
 * Monthly form-submission meter (AGL-76, made coherent in AGL-1280).
 *
 * Submissions were BOTH hard-capped at `formSubmissionsPerMonth` (429) and
 * metered — which made the published promise that usage past the
 * included band is billed rather than cut off false for the one meter where
 * being cut off costs the customer a lead. Now it mirrors the other three
 * overage meters exactly: a plan with the metered pass-through always accepts
 * and prices the excess (`estimateMonthlyUsageCost`); free has no
 * subscription to bill, so its included count stays a hard wall.
 *
 * Priced per ORG at cost-plus, but capped per SITE, because that is where the
 * counter lives (`hosts/{id}/counters/formSubmissions`). Callers gating a
 * single submission pass that site's month count.
 */
export function checkFormSubmissionQuota(
  org: Partial<AglynOrgBilling> | null | undefined,
  usedThisMonth: number,
): FormSubmissionQuotaResult {
  const included = resolveOrgEntitlements(org).formSubmissionsPerMonth
  const metered = planMetersInfraOverage(org)
  const used = Math.max(0, usedThisMonth)
  return {
    allowed: metered ? true : used < included,
    included,
    used,
    remaining: Math.max(0, included - used),
    overageSubmissions: Math.max(0, used - included),
    metered,
  }
}
