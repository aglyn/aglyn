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
import {
  PLATFORM_BRAND_NAME,
  PLATFORM_HOME_URL,
  PLATFORM_MARK_URL,
  PLATFORM_SUPPORT_URL,
} from './platform-brand'

/** Sentinel for quotas a plan does not cap; `checkQuota` always allows. */
export const UNLIMITED = Number.POSITIVE_INFINITY

/**
 * How many saved form definitions one site may hold, on every plan that can
 * build them at all.
 *
 * ⛔ **Not a tier lever, and must not become one.** The website-building field
 * does not meter form COUNT: Squarespace, HubSpot and Mailchimp publish no cap
 * whatsoever, Webflow abandoned the lever above its free tier, and of the two
 * that do meter it one is Wix (4/10/25/75) and the other is Jotform
 * (5/25/50/100), a form-first product where a form IS the billable unit. What
 * this platform meters on the forms axis is `formSubmissionsPerMonth`, which
 * is tiered, metered and part of a charged price.
 *
 * So this is an abuse ceiling wearing an entitlement's clothes. It rides
 * `formsPerHost` because that is where `checkQuota` can refuse a create inside
 * the counting transaction, not because the number is sold — and it resolves
 * to the same value on Starter through Enterprise. Only Free differs, and only
 * because the form entity rides `reusableComponents`, which Free lacks.
 *
 * The value clears every published competitor number by 5x and the largest
 * real catalog by far, and it stays STRICTLY below `FORMS_MAX_PER_HOST` — the
 * page size two listing reads use. The gap is deliberate: a catalog can sit
 * above this ceiling when a per-org override is withdrawn, and the two
 * numbers must stay tellable apart so a surface reading the window where it
 * means the ceiling is never accidentally right. `forms.spec.ts` pins both
 * halves.
 *
 * A per-org `entitlements.formsPerHost` override still resolves ahead of this,
 * so a contract can raise or lower it for one org without moving the ceiling
 * everyone else is measured against.
 */
export const FORMS_PER_HOST_CEILING = 500

/**
 * Is this quota value "no cap"? (AGL-2482; AGL-2223 is the same class.)
 *
 * WHY A PREDICATE AND NOT `x === UNLIMITED`. `UNLIMITED` is
 * `Number.POSITIVE_INFINITY`, and `JSON.stringify(Infinity)` is **`null`** —
 * so the moment an entitlement crosses a route boundary the sentinel is gone
 * and `=== UNLIMITED` is false for a plan that really is uncapped. Worse, the
 * client then reads `Number(null)`, which is `0`, and `Number.isFinite(0)` is
 * TRUE: the value sails through every guard written to reject a payload that
 * cannot state the terms, and the console renders a cap of zero for the most
 * expensive plan on the price list.
 *
 * So: `Infinity`, `null`, `undefined` and `NaN` all read as unlimited here.
 *
 * THIS IS A BACKSTOP, NOT THE FIX. `null` on the wire genuinely cannot
 * distinguish "unlimited" from "the field is missing", and answering
 * "unlimited" for a missing field is the permissive direction — the same
 * shape as `checkQuota(undefined)` resolving to Free. A route that serialises
 * a quota must therefore send a FINITE number plus an explicit boolean flag
 * (see `/api/billing/storage-overage`), and the client must rebuild the
 * sentinel from the flag with `restoreQuotaLimit` before it does arithmetic.
 * This predicate exists so that a surface which has not been given the flag
 * still renders "Unlimited" instead of `0`, `null` or `Infinity`.
 */
export function isUnlimitedQuota(limit: number | null | undefined): boolean {
  return limit == null || !Number.isFinite(limit)
}

/**
 * A quota cap, written the way every surface in the console must write it:
 * `Unlimited` for an uncapped plan, the number otherwise.
 *
 * ONE implementation on purpose. Six surfaces had grown their own copy of the
 * `limit === UNLIMITED ? 'Unlimited' : String(limit)` line and a seventh
 * category — the ones that interpolated the raw number — shipped
 * "Every site can run null registers on your current plan" and
 * "Screen limit reached (Infinity)" to customers.
 *
 * @param limit The cap. Non-finite, `null` and `undefined` are unlimited.
 * @param unit Appended to a finite number only — `MB`, `registers`. Never
 *   appended to `Unlimited`, because "Unlimited MB" reads as a typo.
 */
export function formatQuotaLimit(
  limit: number | null | undefined,
  unit?: string,
): string {
  if (isUnlimitedQuota(limit)) return 'Unlimited'
  return unit ? `${limit} ${unit}` : String(limit)
}

/**
 * Rebuild the `UNLIMITED` sentinel a JSON round-trip flattened, from the
 * explicit flag the route sent alongside the number.
 *
 * The client half of the wire contract. Once this has run, every comparison
 * downstream is ordinary arithmetic that happens to be correct: `used >
 * Infinity` is false, `Math.max(0, used - Infinity)` is `0`, and nothing has
 * to remember that this particular number might be a `null` in disguise.
 *
 * That mattered more than the display did. `1 > null` is **true**, so a site
 * on an unlimited plan was reported "1 over the limit" while the readout
 * beside it said `1/∞` — a false limit warning on a plan that has no limit.
 *
 * @param value The finite number the route sent (or the `null` it sent for a
 *   pre-fix payload).
 * @param unlimited The route's explicit flag. `undefined` means the route has
 *   not been taught to send one, and then `value` decides — non-finite reads
 *   as unlimited, which is the `isUnlimitedQuota` backstop.
 */
export function restoreQuotaLimit(
  value: number | null | undefined,
  unlimited?: boolean,
): number {
  if (unlimited === true) return UNLIMITED
  if (unlimited === false) return Number(value)
  return isUnlimitedQuota(value) ? UNLIMITED : Number(value)
}

/**
 * Campaign emails an Enterprise agreement includes per month, before the
 * contract says otherwise.
 *
 * ## Why the one Enterprise quota that is a number
 *
 * Every other Enterprise band is `UNLIMITED` because the thing behind it is
 * infrastructure we already meter and price into the deal — storage, page
 * views, seats. Email is not that. It is a per-message charge from a third
 * party, so an unbounded allowance is an unbounded liability with no meter
 * underneath it and no ceiling a negotiation ever had to name.
 *
 * `UNLIMITED` was also unrepresentable off-process. It is
 * `Number.POSITIVE_INFINITY`, `JSON.stringify(Infinity)` is `null`, and
 * `Number(null)` is `0` — so the most expensive plan on the price list
 * serialised to a cap of ZERO through any route that did not also send the
 * explicit flag `restoreQuotaLimit` rebuilds from. A finite number crosses
 * the wire as itself.
 *
 * ## Why this number
 *
 * It is what the sending platform can actually deliver to one workspace with
 * room to spare. At the shipped constants a workspace's share is 500 messages
 * an hour and a projected month is 720 hours, so 360,000 is the ceiling
 * nothing can exceed however it is sold. 250,000 spends 500 of those 720
 * hours, leaving the rest for bursts, retries and domain warm-up —
 * `email-ceiling-dimensioning.spec.ts` holds that relation, and holds the
 * platform rate still so the gap cannot be closed by quietly raising it.
 *
 * Selling more than that would be selling mail that cannot leave the
 * building: the hourly ceiling DEFERS rather than refuses, so the excess does
 * not bounce, it simply never sends.
 *
 * ## It is a DEFAULT, and a contract raises it
 *
 * `resolveOrgEntitlements` applies a per-org `entitlements.emailSendsPerMonth`
 * override ahead of this, so a deal that buys more email buys it on that org
 * without moving the figure every other agreement is measured against — the
 * same mechanism `formsPerHost` uses for the same reason.
 */
export const ENTERPRISE_EMAIL_SENDS_PER_MONTH = 250_000

/**
 * Plan → default entitlements. Versioned with the app so pricing changes are
 * code-reviewed; per-org overrides live on `org.entitlements` and win
 * key-by-key. Tier table aligned to the Tenant Billing & SaaS Plans proposal
 * (AGL-67, 2026-07-07): storage-per-host is media storage; the published
 * total-site-size cap it used to exceed by design was retired in AGL-2133.
 * Metered costs are passed through
 * from Firebase/Vercel at cost × 1.30 separately (AGL-41).
 */
/** Legacy host-keyed dataset overrides resolved into org keys (AGL-240). */
type LegacyEntitlementKeys = 'datasetsPerHost' | 'maxDatasetsPerHost'

/**
 * Keys `OrgEntitlements` still carries so stored documents type-check, but
 * that no plan declares and nothing resolves (AGL-2133). Kept as a named type
 * rather than folded into `LegacyEntitlementKeys`: legacy keys are resolved
 * INTO their replacements, retired ones are dropped, and conflating the two
 * would eventually resolve a retired value into something.
 *
 * `RETIRED_ENTITLEMENT_KEYS` is the runtime half and must list the same keys.
 */
type RetiredEntitlementKeys = 'totalSiteSizeMb'

/** Fully-resolved entitlements: every LIVE quota present, features complete. */
export type ResolvedOrgEntitlements = Required<
  Omit<
    OrgEntitlements,
    'features' | LegacyEntitlementKeys | RetiredEntitlementKeys
  >
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
    membersPerHost: 1,
    managersPerOrg: 1,
    maxManagersPerOrg: 1,
    maxMembersPerHost: 1,
    bandwidthGb: 5,
    formSubmissionsPerMonth: 20,
    // No saved-form CATALOG on Free: the form entity rides
    // `reusableComponents`, which is Starter-and-above, so
    // `/api/hosts/resources` refuses the create on the entitlement before it
    // ever reaches this number. Zero is what a Free site actually gets.
    //
    // It does NOT mean a Free site has no forms. A `Form` node placed on a
    // page needs no definition to collect, and the 20 submissions above are
    // the band those replies spend.
    //
    // Every other plan carries `FORMS_PER_HOST_CEILING`. This is the one
    // number on the axis that differs, and it differs because the entitlement
    // gate above it says so, not because the catalog is sold by the tier.
    formsPerHost: 0,
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
    // Marketplace take rate (AGL-46/1543): free-plan sellers pay a higher
    // share. `marketplaceSelling` is false here, so this rate only prices
    // an org GRANTED selling via a per-org feature override — and any org
    // whose dead subscription resolved it down to free.
    marketplaceFeePct: 30,
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
      /**
       * CDN delivery and responsive image variants, on every plan (AGL-1152).
       *
       * Without this, media is addressed by its absolute
       * `firebasestorage.googleapis.com` URL: a visitor fetches the full-size
       * original from Storage egress on every request, with no shared edge
       * cache in front of it. With it, media is served over the CDN path,
       * which is edge-cacheable and returns a resized WebP variant.
       *
       * The ungated path therefore costs more to run, on both bytes per
       * request and origin requests per byte. Gating this would raise the cost
       * of the tier that pays nothing.
       */
      mediaCdn: true,
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
    membersPerHost: 3,
    managersPerOrg: 2,
    maxManagersPerOrg: 5,
    maxMembersPerHost: 10,
    bandwidthGb: 50,
    formSubmissionsPerMonth: 200,
    formsPerHost: FORMS_PER_HOST_CEILING,
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
    marketplaceFeePct: 20,
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
    membersPerHost: 10,
    managersPerOrg: 5,
    maxManagersPerOrg: 20,
    maxMembersPerHost: 25,
    bandwidthGb: 250,
    formSubmissionsPerMonth: 1000,
    formsPerHost: FORMS_PER_HOST_CEILING,
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
    marketplaceFeePct: 20,
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
    membersPerHost: 50,
    managersPerOrg: 15,
    maxManagersPerOrg: 100,
    maxMembersPerHost: 100,
    bandwidthGb: 1000,
    formSubmissionsPerMonth: 10000,
    formsPerHost: FORMS_PER_HOST_CEILING,
    variablesPerHost: 1000,
    functionsPerHost: 250,
    workflowsPerHost: 100,
    workflowRunsPerMonth: 50000,
    servicesPerHost: UNLIMITED,
    redirectsPerHost: UNLIMITED,
    contactsPerHost: 100000,
    emailSendsPerMonth: 25000,
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
    marketplaceFeePct: 20,
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
    membersPerHost: 75,
    managersPerOrg: 25,
    maxManagersPerOrg: 150,
    maxMembersPerHost: 150,
    bandwidthGb: 2500,
    formSubmissionsPerMonth: 50000,
    formsPerHost: FORMS_PER_HOST_CEILING,
    variablesPerHost: 5000,
    functionsPerHost: 500,
    workflowsPerHost: 250,
    workflowRunsPerMonth: 150000,
    servicesPerHost: UNLIMITED,
    redirectsPerHost: UNLIMITED,
    contactsPerHost: 500000,
    emailSendsPerMonth: 40000,
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
    marketplaceFeePct: 20,
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
    membersPerHost: 100,
    managersPerOrg: 50,
    maxManagersPerOrg: 250,
    maxMembersPerHost: 250,
    bandwidthGb: 5000,
    formSubmissionsPerMonth: 100000,
    formsPerHost: FORMS_PER_HOST_CEILING,
    variablesPerHost: UNLIMITED,
    functionsPerHost: 1000,
    workflowsPerHost: 500,
    workflowRunsPerMonth: 500000,
    servicesPerHost: UNLIMITED,
    redirectsPerHost: UNLIMITED,
    contactsPerHost: 1000000,
    emailSendsPerMonth: 65000,
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
    marketplaceFeePct: 20,
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
    membersPerHost: 250,
    managersPerOrg: 100,
    maxManagersPerOrg: 500,
    maxMembersPerHost: 1000,
    bandwidthGb: 20000,
    formSubmissionsPerMonth: UNLIMITED,
    formsPerHost: FORMS_PER_HOST_CEILING,
    variablesPerHost: UNLIMITED,
    functionsPerHost: UNLIMITED,
    workflowsPerHost: UNLIMITED,
    workflowRunsPerMonth: 2000000,
    servicesPerHost: UNLIMITED,
    redirectsPerHost: UNLIMITED,
    contactsPerHost: UNLIMITED,
    emailSendsPerMonth: 130000,
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
    marketplaceFeePct: 20,
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
  // `PLAN_PRICING`. Capacity is Agency's, uncapped: every quota that costs
  // infrastructure is UNLIMITED, byte-size ones included — infra cost is
  // metered and priced into the deal, so a hard wall would only break a
  // customer already paying for the usage. This is the one tier where the
  // AGL-67 "media storage exceeds the published-site cap" invariant is
  // vacuous: both are unbounded.
  // White-label AND SSO ship on the plan itself rather than through the
  // per-org `entitlements` override that Enterprise-as-a-label needed.
  //
  // `emailSendsPerMonth` is the ONE exception, and see the constant for why.
  enterprise: {
    hostLimit: UNLIMITED,
    screensPerHost: UNLIMITED,
    sharedLayoutsPerHost: UNLIMITED,
    templatesPerHost: UNLIMITED,
    storagePerHostMb: UNLIMITED,
    membersPerHost: UNLIMITED,
    managersPerOrg: UNLIMITED,
    maxManagersPerOrg: UNLIMITED,
    maxMembersPerHost: UNLIMITED,
    bandwidthGb: UNLIMITED,
    formSubmissionsPerMonth: UNLIMITED,
    formsPerHost: FORMS_PER_HOST_CEILING,
    variablesPerHost: UNLIMITED,
    functionsPerHost: UNLIMITED,
    workflowsPerHost: UNLIMITED,
    workflowRunsPerMonth: UNLIMITED,
    servicesPerHost: UNLIMITED,
    redirectsPerHost: UNLIMITED,
    contactsPerHost: UNLIMITED,
    emailSendsPerMonth: ENTERPRISE_EMAIL_SENDS_PER_MONTH,
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
    marketplaceFeePct: 20,
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

/**
 * Purchase ceilings for the two add-on kinds that have NO per-plan hard max
 * (AGL-1738). They live here, beside the bands and the resolver they bound,
 * because they ARE the bound — and until now they were two private literals
 * in `app/api/billing/addons/route.ts`, seventeen hundred lines and one
 * project away from the `+` they cap.
 *
 * That distance is why AGL-1738 read `resolveOrgEntitlements` as unbounded
 * and proposed a `maxPosRegistersPerHost` clamp. Do not add one. Seats and
 * datasets clamp at `checkSeatQuota` / `checkDatasetQuota` because their
 * plans genuinely refuse to sell past a band (`upgradeRequired` flips and
 * the answer is a plan change). Registers and extra sites are sold flat
 * instead: `addonMax()` will sell an org up to these quantities on ANY plan
 * carrying the feature, so a band-shaped clamp in the resolver would take
 * back registers the merchant is being invoiced $89/mo each for — the
 * expensive direction of a wrong clamp, and the reason the add stays open.
 *
 * The self-serve route is the only path that writes `seatAddons` from a
 * purchase, so these are the real ceilings: a plan's band plus at most
 * `POS_REGISTERS_ADDON_MAX` registers, or plus `EXTRA_HOSTS_ADDON_MAX` sites.
 * Any console surface that windows a head-count must clear the SUM, not the
 * band (`registers-card.component.tsx` still windows at 25; AGL-1738).
 */
export const EXTRA_HOSTS_ADDON_MAX = 100

/** @see EXTRA_HOSTS_ADDON_MAX — the flat register ceiling, per org. */
export const POS_REGISTERS_ADDON_MAX = 50

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
   * Retail overage per 1,000 emails beyond `emailSendsPerMonth`.
   *
   * ## What it prices, which is not what the cap refuses
   *
   * The cap is enforced against CAMPAIGN sends alone and refuses them at the
   * band — a campaign is discretionary, so the plan is allowed to say no.
   * Transactional mail is never refused at any tier, so an org finishes the
   * month above its band whenever receipts, invites, booking reminders and
   * workflow notifications carry it there. That excess is real provider spend
   * that no gate could have stopped, and this is the rate it bills at.
   *
   * ## Retail, NOT the infrastructure pass-through
   *
   * `meteredInfraPassThrough` covers exactly three meters — storage, page
   * views, form submissions — and the published term for those is "at cost +
   * 30%", which makes the figure in `METERED_BILLED_RATES_USD` the claim
   * itself. Email is not in that set and this rate is not derived from
   * `METERED_MARKUP`: it is a price, set beside `extraContactsUsdPer1k` and
   * `extraApiRequestsUsdPer1k`, and it descends with the tier the way both of
   * those do. Describing it as "at cost" anywhere would make the pass-through
   * sentence false about three meters that really are.
   *
   * Our own per-email cost is `ORG_COGS_UNIT_RATES_USD.perEmailSend`, and it
   * is a cost-model input rather than anything a customer is quoted.
   *
   * ## The floor, and why the ladder stops descending
   *
   * Every retail line must carry at least a 50% margin, and at a cost of
   * $0.90 per 1,000 that floor is $1.80. The ladder still steps down with
   * volume the way contacts and API requests do — a larger plan pays less per
   * message — it simply stops at the floor instead of running past it, which
   * is what the contacts ladder did when it reached $0.25 against a $0.20
   * cost.
   *
   * Null on free, whose band is 0 and which has no subscription to hang a
   * metered item on, and null on enterprise, where every rate is the
   * "not for sale" sentinel and the terms are contractual. Every OTHER paid
   * tier carries one, Starter and Pro included: their bands are small but
   * real, and transactional mail cannot be refused at any tier, so a null
   * there is not "no overage" — it is unbounded absorbed spend on the two
   * cheapest subscriptions the platform sells.
   */
  extraEmailSendsUsdPer1k: number | null
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
    extraEmailSendsUsdPer1k: null,
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
    extraEmailSendsUsdPer1k: 2.5,
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
    extraEmailSendsUsdPer1k: 2.25,
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
    extraEmailSendsUsdPer1k: 2,
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
    extraEmailSendsUsdPer1k: 1.9,
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
    // FLOORED at the 50% retail margin, not stepped down again. The ladder
    // above it descends $1.00 → $0.75 → $0.50 → $0.40, and one more step
    // would have reached $0.25 against a `perContactMonth` cost of $0.20 per
    // 1,000 — a 20% line margin on a retail price, thinner than the 23% the
    // infrastructure pass-through earns while being sold as cost recovery.
    extraContactsUsdPer1k: 0.4,
    extraEmailSendsUsdPer1k: 1.85,
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
    // NULL, not 0.2, because Agency's `contactsPerHost` is UNLIMITED and an
    // uncapped band has no "over" (AGL-2439). The rate was unreachable
    // — `checkContactQuota` computes `Math.max(0, used - Infinity)`, which is
    // 0 at every usage level — so no charge changes; what changes is that we
    // stop advertising a fee we could never collect. The plan card and
    // `/pricing` both already suppress the suffix when this is null.
    extraContactsUsdPer1k: null,
    extraEmailSendsUsdPer1k: 1.8,
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
    extraEmailSendsUsdPer1k: null,
    meteredInfraPassThrough: false,
  },
}

/**
 * Subscription states that stop paying for the plan (AGL-247). `past_due`
 * keeps working as a dunning grace period; these do not.
 *
 * `incomplete_expired` is the state a signup reaches when its first payment
 * never completes — an abandoned SCA challenge, a card that never
 * authenticated — and Stripe stamps it about a day later. It has charged
 * nothing and never will, so it belongs here beside `incomplete`, which is the
 * same subscription an hour earlier. `LIVE_SUBSCRIPTION_STATUSES` in
 * `org-billing-doc.ts` already excludes it and `DEAD_STATUSES` in
 * `utils/subscription-period-notice.ts` already names it; this set is the one
 * that decides both what a workspace GETS and whether we count it as revenue,
 * so it is the one place the omission cost money in both directions at once.
 *
 * THE DENYLIST FORM IS THE HAZARD, and it is why the omission was silent: an
 * allowlist of live statuses cannot rot when Stripe adds a status, whereas a
 * denylist of dead ones silently grants the plan — and books the MRR — for
 * every status nobody has enumerated yet. The three readers below keep the
 * denylist anyway, because the direction they fail in is not the same as the
 * live-side question's: an unrecognized status here must not revoke a paying
 * workspace's features, while `isLiveSubscriptionStatus` refusing to call an
 * unrecognized status live only ever declines to sell a second subscription.
 * A new Stripe status therefore has to be added HERE by hand, which is a
 * standing obligation rather than a property of the code.
 */
const DEAD_SUBSCRIPTION_STATUSES = new Set([
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
])

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
 *  - an explicit **`org.enterprise`** marker — a *comped* enterprise account,
 *    100%-discounted so it collects $0 while infra cost is still metered.
 *
 * ⚠️ This function answers ONE question — "does this org read as Enterprise" —
 * and it is not the same question as "what does this org get". Only the first
 * bullet grants anything: `resolveEffectivePlan` reads `org.plan` and nothing
 * else, so `org.enterprise` and `customMonthlyUsd` are read NOWHERE but here.
 * A comped or custom-priced org resolves its BASE plan's entitlements, and
 * gets Enterprise capability through a per-org `entitlements` override — see
 * `ssoEnabled`, whose docblock calls that "how enterprise orgs provisioned
 * before that plan existed still get it".
 *
 * This paragraph replaces a parenthetical claiming the comped marker carried
 * "full Enterprise capability + SSO" (AGL-2297). It never did, and the billing
 * page believed it: the Enterprise card ticked five entitlements against any
 * org this function marked, so a comped org whose overrides granted SSO but
 * not white-label was shown a green tick for full white-label while the
 * branding card correctly refused it.
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
 *
 * WHAT THIS IS A FLOOR ON (AGL-1930): net revenue less INFRASTRUCTURE COGS,
 * and nothing else. It is a contribution margin — see `MARGIN_SCOPE_NOTE`,
 * which is the sentence every staff surface quoting this number has to print
 * beside it.
 *
 * Read as a dollar guard it says: net revenue must be at least
 * `cogs / (1 − floor)` = **4 × COGS**, and blocks below
 * `cogs / (1 − floor + band)` ≈ **2.86 × COGS**. That restatement is the point
 * of AGL-1930 — the percentage is scale-invariant, so the only thing that
 * moves the real guard line in dollars is the COGS figure fed into it, and on
 * production today that figure is `INFRA_COGS_PER_SITE_USD × sites` for
 * **every** org (14 of 14 usage rollups across all 6 orgs, measured
 * 2026-08-24). Re-tuning this constant therefore re-tunes a multiplier on the
 * flat floor, not on anything measured. Calibrate the floor first.
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
 * What every "net margin" figure in the staff console actually measures
 * (AGL-1930).
 *
 * `checkDiscountMargin`, the enterprise quote card and the coupon badge all
 * compute `(net revenue − infrastructure COGS) / net revenue`. Support,
 * acquisition and overhead are not in the model anywhere — no meter records
 * them and no constant estimates them — so "net margin 78%" is a CONTRIBUTION
 * margin, and a staff member signing a deal on it is reading a ceiling, not a
 * profit.
 *
 * One exported string rather than three literals: the three surfaces that
 * print a margin already drifted apart once (AGL-1134), and a caveat that is
 * true on one screen and absent on the next is worse than none.
 */
export const MARGIN_SCOPE_NOTE =
  'Contribution margin: net revenue less infrastructure COGS only. ' +
  'Support, customer acquisition (CAC) and overhead are not in this figure.'

/**
 * The `ok` / `warn` / `block` band a cost-recovery margin falls in (AGL-1930).
 *
 * Extracted so `NET_MARGIN_FLOOR_PCT` and `NET_MARGIN_WARN_BAND_PCT` have ONE
 * reader. The staff org page's enterprise quote card had `>= 0.75` and
 * `>= 0.65` written into its JSX, so re-tuning either constant — the whole
 * subject of AGL-1930 — would have moved the discount guardrail and left that
 * card rating deals against the old numbers, silently and with money on the
 * line.
 */
export function netMarginRating(marginPct: number): DiscountMarginRating {
  return marginPct >= NET_MARGIN_FLOOR_PCT
    ? 'ok'
    : marginPct >= NET_MARGIN_FLOOR_PCT - NET_MARGIN_WARN_BAND_PCT
      ? 'warn'
      : 'block'
}

/**
 * Per-site monthly infrastructure COGS in USD (AGL-1105). The
 * Enterprise-Pricing-Calculator's ~$2/site figure — Firebase + Vercel at
 * cost — charged against every host the org runs. The margin guardrail
 * subtracts this from net revenue before rating a discount.
 */
export const INFRA_COGS_PER_SITE_USD = 2

/**
 * Platform markup on passed-through infrastructure costs (AGL-41).
 *
 * DEFINED HERE, not in `apps/console/utils/usage-metering.ts`, and re-exported
 * from there — the same move AGL-2155 made for `pageViewsFromBandwidthGb`, and
 * for the same reason (AGL-2194). The published `/pricing` pass-through table
 * states both a cost column and a "you pay (+30%)" column, and
 * `tools/marketing/build-pricing-tables.mts` must generate both from code so
 * `npm run check:pricing-tables` can fail on drift. That generator resolves no
 * `@aglyn/*` path alias, so it can import `plan-entitlements.ts` and nothing
 * under `apps/console`. A constant the published page depends on must live
 * where the page's generator can read it.
 *
 * The console keeps importing it from `usage-metering` unchanged.
 */
export const METERED_MARKUP = 1.3

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
 * the reads behind them. Treat every operator-tuned figure here as
 * provisional until validated against a real Firebase + Vercel invoice month;
 * AGL-1134 says so out loud rather than implying the numbers are derived.
 * `perEmailSend` is the exception and carries its own basis below.
 *
 * ## Three of these are shared with the billed table. The rest are NOT.
 *
 * `storagePerGbMonth`, `perPageView` and `perFormSubmission` are the metered
 * infrastructure pass-through, and the customer is charged those figures
 * times `METERED_MARKUP`. They therefore appear in `METERED_UNIT_RATES_USD`
 * as well, with identical values, and must be changed in both places at once.
 *
 * Everything else here is a cost-model input ONLY. `dataStoragePerGbMonth`,
 * `perApiRequest`, `perContactMonth` and `perEmailSend` price what an org
 * costs us; what an org is CHARGED on those axes is a retail rate on
 * `PLAN_PRICING` that descends with the tier and is not derived from cost.
 * Adding one of them to `METERED_UNIT_RATES_USD` would put it inside the
 * "at cost + 30%" claim, which is true of exactly three meters.
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
  /**
   * One delivered email, whatever produced it — $0.90 per 1,000.
   *
   * Unlike its five neighbours this is not an operator-tuned estimate. It is
   * the provider's own blended rate at the tier above the account's current
   * one ($90 / 100,000) and also the marginal overage rate on both that tier
   * and the current one, so it does not fall as volume grows and is the
   * conservative figure at any usage the platform can reach.
   *
   * It prices EVERY send on the cost meter — campaigns, receipts, invites,
   * password resets — because every one of them is a message the provider
   * charges for. The band on the plan and the retail overage rate beside it
   * both concern a smaller quantity; this is the whole bill.
   */
  perEmailSend: 0.0009,
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
  /**
   * Every email the org sent this month, campaigns and transactional alike —
   * the `emailSends` cost meter, not `campaignEmailSends`.
   *
   * The cost meter is the right input precisely because the campaign meter is
   * the one with a cap on it. What this org cost us is every message the
   * provider charged for, and most of them are messages no quota could have
   * refused.
   */
  emailSends?: number | null
  /**
   * Aglyn Assist provider spend for the month, ALREADY IN DOLLARS (AGL-2280).
   *
   * Unlike every other field here this is not a meter to be priced — it is
   * `orgs/{id}/assistUsage/{month}.estCostUsd`, our own cost estimate at the
   * provider's list rates, computed where the tokens were counted. So it
   * enters the model at ×1 and has no entry in `ORG_COGS_UNIT_RATES_USD`;
   * inventing a second per-token rate here is precisely the drift AGL-1134
   * removed.
   */
  assistCostUsd?: number | null
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
    // Every send, not the overage — the provider bills the first message of
    // the month as much as the last, so a cost model that started counting at
    // the plan's included band would report an org that stayed inside its
    // allowance as free.
    emailSends: num(rollup?.emailSends) * rates.perEmailSend,
    /*==========================================
     * AGLYN ASSIST PROVIDER SPEND (AGL-2280).
     *
     * Already dollars, so ×1 — see `OrgUsageRollupInput.assistCostUsd`.
     *
     * This is the ONE meter on the platform whose unit cost is not a fraction
     * margin model read it: the discount guardrail priced six meters that
     * together measured $0.0000054 for the largest real org, and ignored the
     * only line item that can plausibly clear the $2/site floor on its own.
     * A 93%-off coupon on an org burning $40/month of tokens rated green.
     *
     * It is deliberately NOT in `billedCents` — what an org is charged is a
     * separate decision with a price sheet behind it. This is what the org
     * COSTS US, which is the only question the guardrail asks.
     *=========================================*/
    assist: num(rollup?.assistCostUsd),
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
 * `formSubmissions`, `apiRequests` and `emailSends` are counts FOR THE MONTH;
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
    emailSends: read('emailSends'),
    // AGL-2280. Dollars, not a meter — the projection still has to forward it
    // or the model prices Assist at nothing, which is the direction that
    // approves a discount.
    assistCostUsd: read('assistCostUsd'),
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
 * Where a cost figure came from, in a sentence a staff member can act on
 * (AGL-1930).
 *
 * The staff quote card said `per-site floor — no usage recorded yet` for
 * EVERY `basis: 'floor'` org. Measured against production 2026-08-24 that
 * sentence is false on most of them: all 14 usage rollups across all 6 orgs
 * price under the floor, and 9 of the 14 carry genuinely non-zero usage — the
 * largest real org measured **$0.22** against its $2.00 floor. "No usage
 * recorded" and "usage recorded, and it came in under the floor" are opposite
 * facts about the cost model, and only the second one is evidence the meters
 * are working at all.
 *
 * Same failure family as AGL-1380 / AGL-1422 — a measurement-shaped sentence
 * printed over a measurement that was never consulted — one layer further in:
 * here the measurement exists and the copy denies it.
 */
export function orgCogsBasisSummary(
  cogs: OrgCogsResult,
  month?: string | null,
): string {
  const when = month ?? 'the latest'
  if (cogs.basis === 'measured') return `measured from ${when} usage`
  // Absent and zero are NOT the same claim, and with `strictNullChecks` off an
  // absent meter reads as 0 all the way down — so this leans on the caller's
  // `orgCogsPreview` readiness gate for "has a rollup arrived", and reports
  // only what the priced total says.
  if (!(cogs.measuredUsd > 0)) return 'per-site floor — no usage recorded yet'
  // Cents are the wrong precision for these figures and rounding to them
  // prints `$0.00`, which reads as the "no usage" claim this function exists
  // to stop making. Every real org's measured month is under a cent.
  const measured =
    cogs.measuredUsd < 0.01
      ? cogs.measuredUsd.toFixed(4)
      : cogs.measuredUsd.toFixed(2)
  return (
    `per-site floor — ${when} usage measured ` +
    `$${measured}, under the $${cogs.floorUsd.toFixed(2)} floor`
  )
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
  // Same bands the staff quote card renders — one reader for the two
  // constants (AGL-1930), so a re-tune cannot reach the guardrail and miss
  // the UI.
  const cogsRating: DiscountMarginRating = netMarginRating(marginPct)

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
 * Numeric entitlement keys that were REMOVED from `PLAN_ENTITLEMENTS` and
 * must never be resolved again from a stored override (AGL-2133).
 *
 * `totalSiteSizeMb` is the first. It carried a value on all 8 plans and was
 * enforced by nothing — no gate, no meter, no alert. AGL-1107 added it and
 * AGL-1370 deleted its meter and its alert on measurement rather than taste:
 * `measure-node-map.ts` refuses any node map over 900 KB (AGL-678), so the
 * measurable org total tops out at 2.3–20.9% of the cap depending on plan.
 * What survived was a WRITABLE staff override field for a number nothing
 * read, so a support engineer resolving a "this site is too big" ticket
 * raised it, got a success and an audit row, and changed nothing.
 *
 * WIRING IT WAS THE OTHER OPTION AND IT IS WORSE. A cap the measurement can
 * reach a fifth of is a gate that refuses nobody — the same "reports success,
 * does nothing" shape, moved from the staff dialog to the enforcement point,
 * plus a new hard wall introduced days before launch. The per-site size
 * ceiling that actually binds is AGL-678's 900 KB node map, and it is real.
 *
 * The rollup's `siteSizeMb` MEASUREMENT stays — host-usage and the usage
 * audit read it, and it is a genuine internal signal. Only the entitlement
 * goes.
 */
export const RETIRED_ENTITLEMENT_KEYS: ReadonlySet<string> = new Set([
  'totalSiteSizeMb',
])

/**
 * Effective entitlements for an org: plan defaults with the org doc's
 * per-key overrides applied (features merge key-by-key too), then
 * purchased add-ons stacked on top (AGL-524): `seatAddons.hosts` raises
 * `hostLimit` and `seatAddons.eventCalendar` switches the `eventCalendar`
 * feature on. (Seat/dataset add-ons instead fold in at `checkSeatQuota` /
 * `checkDatasetQuota`, where the per-plan hard max clamps them.)
 * Missing or unknown plans resolve as `free`.
 *
 * `hostLimit` is DELIBERATELY unclamped here (AGL-1738): there is no
 * `maxHostsPerOrg` to clamp against, because extra sites are sold flat rather
 * than up to a band. Their bound is the purchase ceiling,
 * `EXTRA_HOSTS_ADDON_MAX`, and a band-shaped `Math.min` added here would
 * silently disable sites the org is invoiced for. See that constant before
 * "fixing" this add.
 *
 * `posRegisters` IS NOT ADDED HERE, and this is the fix, not an omission
 * (AGL-1775). The register add-on is priced "per
 * extra register/location" and enforced PER SITE, so folding the org-wide
 * purchase into an org-level value every site inherits sold one register and
 * delivered `hostLimit` of them. `seatAddons.posRegisters` is now a POOL and
 * `org.registerAllocations` says which site holds each seat. The number this
 * function returns for `posRegisters` is therefore **the plan's cap alone** —
 * exactly what an unallocated site must resolve to. Per-site capacity comes
 * from `resolveHostRegisterCap(org, hostId)`; nothing else may add the pool
 * back in.
 *
 * (`eventCalendar` is still org-wide on purpose: it is documented and priced
 * as "one purchase covers every host in the org". The register add-on never
 * was, which is the whole difference.)
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
      // A RETIRED quota's stored override is dropped, not merged (AGL-2133).
      // This loop copies any numeric key it finds, so removing a key from
      // `PLAN_ENTITLEMENTS` alone would leave the value that staff already
      // wrote onto live org documents still appearing on the resolved
      // entitlements — a number with no default behind it and no reader in
      // front of it, which is a worse artefact than the field that produced
      // it. `tools/scripts/strip-retired-entitlements.mjs` clears them from
      // Firestore; this makes the resolver correct before it has run, and
      // stays correct if a document is restored from an old backup.
      if (RETIRED_ENTITLEMENT_KEYS.has(key)) continue
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
  const eventCalendar = (purchased.eventCalendar ?? 0) >= 1
  if (!extraHosts && !eventCalendar) return resolved
  return {
    ...resolved,
    hostLimit: resolved.hostLimit + extraHosts,
    features: eventCalendar
      ? { ...resolved.features, eventCalendar: true }
      : resolved.features,
  }
}

/**
 * The org's POS register pool (AGL-1775): how many seats were purchased, how
 * many are assigned to a site, and how many are left to assign.
 *
 * `purchased` runs through `resolvePurchasedAddons`, so a dead subscription
 * empties the pool exactly as it empties every other add-on — the seats stop
 * counting when they stop billing.
 *
 * `byHost` is the SANITISED allocation, and it never sums past `purchased`.
 * The write path validates before it stores, so an over-allocated map means
 * the data is stale or corrupt (a purchase reduced without the allocation
 * being trimmed, a partial write, a hand edit). Both directions of getting
 * that wrong cost money, so it is resolved rather than trusted: hosts are
 * walked in sorted-id order and granted what remains of the pool, which is
 * deterministic — the same host gets the same answer on every reader — and
 * cannot hand out capacity nobody paid for.
 *
 * Every value is coerced: a non-number, `NaN`, `Infinity` or a negative reads
 * as zero seats. An `Infinity` in this map would otherwise become an
 * unbounded per-site register cap, which is the one outcome the guard in
 * `resolveHostRegisterCap` exists to make impossible.
 */
export function resolveRegisterSeatPool(
  org: Partial<AglynOrgBilling> | null | undefined,
): {
  purchased: number
  allocated: number
  available: number
  byHost: Record<string, number>
} {
  const rawPurchased = resolvePurchasedAddons(org).posRegisters
  const purchased =
    Number.isFinite(rawPurchased) && (rawPurchased as number) > 0
      ? Math.floor(rawPurchased as number)
      : 0
  const raw = org?.registerAllocations
  const byHost: Record<string, number> = {}
  let allocated = 0
  if (raw && typeof raw === 'object') {
    for (const hostId of Object.keys(raw).sort()) {
      if (allocated >= purchased) break
      const value = Number((raw as Record<string, unknown>)[hostId])
      if (!Number.isFinite(value) || value <= 0) continue
      const seats = Math.min(Math.floor(value), purchased - allocated)
      if (seats <= 0) continue
      byHost[hostId] = seats
      allocated += seats
    }
  }
  return { purchased, allocated, available: purchased - allocated, byHost }
}

/**
 * How many POS registers one SITE may run (AGL-1775): the plan's per-site cap
 * plus whatever the org has assigned to that site out of the pool.
 *
 * THE GUARD, and the reason this is a function rather than a lookup. An
 * unallocated host — no entry in `registerAllocations`, a missing map, a
 * missing org, an org still loading — resolves to `resolveOrgEntitlements(org)
 * .posRegisters`, which since AGL-1775 is the PLAN's cap and nothing else.
 * Never the pooled total, and never `Infinity` unless the plan itself is
 * `UNLIMITED` (enterprise, where an unbounded cap is what was sold).
 *
 * `checkQuota(undefined)` resolving to the Free tier is the lesson this
 * inverts: an absent input there quietly answered a question in the
 * PERMISSIVE direction on the day it mattered. Here the absent input answers
 * in the direction of the plan, which is the conservative one — a site that
 * has been assigned seats and whose allocation failed to load runs fewer
 * registers than it paid for, which the console can say out loud, rather than
 * more than it paid for, which nothing would ever notice.
 *
 * There is deliberately no separate read: the allocation lives on the org doc
 * beside the entitlements, so a caller holding one holds the other.
 */
export function resolveHostRegisterCap(
  org: Partial<AglynOrgBilling> | null | undefined,
  hostId: string | null | undefined,
): number {
  const planCap = resolveOrgEntitlements(org).posRegisters
  if (!hostId) return planCap
  // An UNLIMITED plan cap plus anything is still UNLIMITED; short-circuit so
  // `Infinity + n` never has to be reasoned about downstream.
  if (planCap === UNLIMITED) return UNLIMITED
  return planCap + (resolveRegisterSeatPool(org).byHost[hostId] ?? 0)
}

/**
 * The org's COLLABORATOR seat pool (AGL-2439): how many per-site collaborator
 * seats were purchased, how many are assigned to a site, and how many are
 * left to assign.
 *
 * The AGL-1775 register mechanism, applied to the key it was never applied to.
 * `seatAddons.members` is bought once, org-wide; `membersPerHost` is enforced
 * PER SITE. Adding one to the other handed the whole purchase to every site,
 * so an org with 20 sites that bought ONE extra collaborator seat received 20.
 * The quantity is now the size of an org-level pool and
 * `org.collaboratorAllocations` says which site holds each seat.
 *
 * Everything about the resolution is deliberately identical to
 * `resolveRegisterSeatPool` — the same clamp, the same sorted-id determinism,
 * the same coercion of a non-number / `NaN` / `Infinity` / negative to zero.
 * This is ONE mechanism used twice, not a second mechanism that happens to
 * rhyme: a reader who has understood the register pool has understood this,
 * and a fix to one is a fix to both.
 *
 * `purchased` runs through `resolvePurchasedAddons`, so a dead subscription
 * empties the pool exactly as it empties every other add-on.
 */
export function resolveCollaboratorSeatPool(
  org: Partial<AglynOrgBilling> | null | undefined,
): {
  purchased: number
  allocated: number
  available: number
  byHost: Record<string, number>
} {
  const rawPurchased = resolvePurchasedAddons(org).members
  const purchased =
    Number.isFinite(rawPurchased) && (rawPurchased as number) > 0
      ? Math.floor(rawPurchased as number)
      : 0
  const raw = org?.collaboratorAllocations
  const byHost: Record<string, number> = {}
  let allocated = 0
  if (raw && typeof raw === 'object') {
    for (const hostId of Object.keys(raw).sort()) {
      if (allocated >= purchased) break
      const value = Number((raw as Record<string, unknown>)[hostId])
      if (!Number.isFinite(value) || value <= 0) continue
      const seats = Math.min(Math.floor(value), purchased - allocated)
      if (seats <= 0) continue
      byHost[hostId] = seats
      allocated += seats
    }
  }
  return { purchased, allocated, available: purchased - allocated, byHost }
}

/**
 * How many console COLLABORATORS one SITE may hold (AGL-2439): the plan's
 * per-site allowance plus whatever the org has assigned to that site out of
 * the pool, clamped to the plan's hard `maxMembersPerHost`.
 *
 * THE GUARD, and the reason this is a function rather than a lookup. An
 * unallocated host — no entry in `collaboratorAllocations`, a missing map, a
 * missing org, an org still loading — resolves to the PLAN's `membersPerHost`
 * and nothing else. Never the pooled total, and never `Infinity` unless the
 * plan itself is `UNLIMITED` (enterprise, where an unbounded cap is what was
 * sold). `checkQuota(undefined)` resolving to the Free tier is the lesson
 * this inverts: the absent input answers in the direction of the plan, which
 * is the conservative one.
 *
 * The clamp is what `checkSeatQuota` always did and is kept: collaborator
 * seats are sold up to a BAND (`maxMembersPerHost`), unlike registers, which
 * are sold flat. Assigning more pool seats to a site than the band allows
 * cannot lift it past the band — the org must upgrade the plan.
 *
 * There is deliberately no separate read: the allocation lives on the org doc
 * beside the entitlements, so a caller holding one holds the other.
 */
export function resolveHostCollaboratorCap(
  org: Partial<AglynOrgBilling> | null | undefined,
  hostId: string | null | undefined,
): number {
  const entitlements = resolveOrgEntitlements(org)
  const included = entitlements.membersPerHost
  const maxSeats = entitlements.maxMembersPerHost
  if (!hostId) return Math.min(included, maxSeats)
  // An UNLIMITED plan cap plus anything is still UNLIMITED; short-circuit so
  // `Infinity + n` never has to be reasoned about downstream.
  if (included === UNLIMITED) return UNLIMITED
  const assigned = resolveCollaboratorSeatPool(org).byHost[hostId] ?? 0
  return Math.min(included + assigned, maxSeats)
}

/**
 * Quota answer for a site's console COLLABORATORS (AGL-2439) — the
 * host-scoped `checkSeatQuota`, in the same `SeatQuotaResult` shape so the
 * existing call sites and refusal copy read identically.
 *
 * `checkSeatQuota(org, 'members', …)` is WRONG for a site now and this exists
 * so nobody has to remember why: since AGL-2439 that helper no longer folds
 * the org-wide purchase into a per-site number, so it answers the PLAN's cap
 * and would refuse a site the seats it holds.
 *
 * ## THE GRANDFATHER BOUNDARY — explicit, and this field is it
 *
 * The cap is corrected, and no org already above it is evicted or locked
 * out.
 *
 * The boundary is drawn between two different questions, and they are
 * different lines of code rather than one number used for two purposes:
 *
 *   `allowed`           — may this site take on ANOTHER collaborator? Bound
 *                         by `limit`, the corrected cap. This is the ONLY
 *                         thing the cap decides.
 *   `retainedOverCap`   — how many seats this site holds ABOVE `limit`. They
 *                         are RETAINED. Nothing in this repo revokes a
 *                         collaborator for being over a cap, and nothing may
 *                         be added that does: the cap binds ALLOCATION, never
 *                         ACCESS.
 *
 * So an over-cap site keeps every collaborator it has, cannot add another,
 * and returns to normal by attrition, by buying pool seats and assigning them
 * here, or by upgrading — at which point `limit` recomputes from the new plan
 * or allocation and the retention lapses on its own. That is what "they keep
 * what they have until they next change plan or seat count" means, resolved
 * rather than stored: a stored floor would need a backfill over live orgs and
 * would be a defaulted field on a `merge`-written document, which is the
 * converter hazard that destroys the real value it was meant to protect.
 *
 * `retainedOverCap` is non-zero ONLY when the site is already over. It is not
 * headroom and cannot be spent: it is a count the console says out loud so
 * the customer sees why the next Add is refused while nobody loses access.
 */
export function checkHostCollaboratorQuota(
  org: Partial<AglynOrgBilling> | null | undefined,
  hostId: string | null | undefined,
  currentUsage: number,
): SeatQuotaResult & {
  /** Seats held ABOVE `limit`, retained and never revoked (the grandfather). */
  retainedOverCap: number
  /** Pool seats the org has assigned to THIS site. */
  assignedSeats: number
} {
  const entitlements = resolveOrgEntitlements(org)
  const pricing = PLAN_PRICING[resolvePlan(org)]
  const included = entitlements.membersPerHost
  const maxSeats = entitlements.maxMembersPerHost
  const addonPriceUsd = pricing.extraCollaboratorMonthlyUsd
  const assignedSeats = resolveCollaboratorSeatPool(org).byHost[hostId ?? ''] ?? 0
  const limit = resolveHostCollaboratorCap(org, hostId)
  return {
    allowed: currentUsage < limit,
    limit,
    remaining: Math.max(0, limit - currentUsage),
    included,
    purchased: assignedSeats,
    maxSeats,
    upgradeRequired: addonPriceUsd === null || limit >= maxSeats,
    addonPriceUsd,
    // THE GRANDFATHER. `Math.max(0, …)` so a site under its cap reports zero
    // rather than a negative that a caller could add and turn into headroom.
    retainedOverCap: Math.max(0, currentUsage - limit),
    assignedSeats,
  }
}

/**
 * Quota answer for a site's POS registers (AGL-1775) — the register-shaped
 * `checkQuota`, in the same `{ allowed, limit, remaining }` shape so callers
 * read identically.
 *
 * `checkQuota(org, 'posRegisters', used)` is WRONG for registers now and this
 * exists so nobody has to remember why: that helper resolves the org-level
 * value, which is the plan cap with no pool in it, so it would refuse a site
 * the seats it holds. Everything that gates a register creation calls this.
 */
export function checkHostRegisterQuota(
  org: Partial<AglynOrgBilling> | null | undefined,
  hostId: string | null | undefined,
  currentUsage: number,
): { allowed: boolean; limit: number; remaining: number } {
  const limit = resolveHostRegisterCap(org, hostId)
  return {
    allowed: currentUsage < limit,
    limit,
    remaining: Math.max(0, limit - currentUsage),
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
  const key =
    productType === 'physical'
      ? 'transactionFeePhysicalPct'
      : 'transactionFeeDigitalPct'
  // A MALFORMED value falls back to the PLAN'S OWN rate, never to zero
  // (AGL-2114). `resolveOrgEntitlements` merges any numeric override
  // indistinguishably from the default, and `strictNullChecks` is off
  // repo-wide, so a `NaN`, an `Infinity`, a stringly-typed number or a
  // negative can reach here from a hand-edited or partially-written org doc.
  // This used to answer 0 for every one of them — silently zeroing the
  // platform's cut on a PAYING merchant's storefront, which on a destination
  // charge is not "no take rate" but a loss (see below).
  //
  // The sibling `resolveMarketplaceFeePct` has forbidden exactly this since
  // AGL-1543, in as many words: "A malformed override must never zero the
  // platform's cut." This is the storefront half of the same rule. The plan
  // table is a literal and cannot itself be malformed, so it is the honest
  // floor — and it preserves the tiers whose 0% is a DELIBERATE, advertised
  // rate rather than a data fault.
  const raw = entitlements[key]
  const pct =
    typeof raw === 'number' && Number.isFinite(raw) && raw >= 0
      ? raw
      : PLAN_ENTITLEMENTS[resolvePlan(org)][key]
  if (Number.isFinite(pct) && pct > 0) return pct
  // The free plan's 0% prices a plan that CANNOT SELL: `features.commerce` is
  // false there, so on an ordinary free org this rate is never consulted. It
  // IS consulted for the one org shape that can reach a storefront on the free
  // entitlement set — a per-org `features.commerce` override — and 0% on a
  // DESTINATION charge is not "no take rate", it is a loss: Stripe's
  // processing fee (2.9% + 30¢) and any $15 dispute fee are debited from the
  // PLATFORM's balance, so every sale costs Aglyn money (AGL-2071).
  //
  // `marketplaceFeePct: 30` on the free row is the same decision already made
  // for marketplace selling, and its comment says so in as many words: the
  // rate exists to price "an org GRANTED selling via a per-org feature
  // override". This is the missing equivalent for storefront sales, expressed
  // here rather than in the table because the plan CARDS render the table —
  // `billing-plan-cards.component.tsx:444` — and a Free card advertising a
  // transaction fee for selling it does not permit would be a pricing lie.
  //
  // A staff fee override wins even at 0: `resolveOrgEntitlements` merges any
  // numeric override indistinguishably from the default, so the raw doc is
  // what separates "nobody set a rate" from a deliberately comped one. That
  // decision has a name and a reason attached (`org-override-reason.ts`), and
  // this floor must not silently overrule it.
  if (
    resolvePlan(org) === 'free' &&
    entitlements.features.commerce &&
    typeof org?.entitlements?.[key] !== 'number'
  ) {
    return PLAN_ENTITLEMENTS.starter[key]
  }
  return 0
}

/**
 * Stripe's processing cost on ONE storefront destination charge, in cents
 * (AGL-2152) — the dearest enabled method's percentage plus the fixed 30¢,
 * rounded UP on the percentage so the answer is never a cent short of what
 * Stripe actually debits.
 *
 * WHO PAYS THIS. Every storefront charge is a DESTINATION charge:
 * `payment_intent_data[transfer_data][destination]` names the merchant's
 * connected account and no `transfer_data[amount]` is sent, so Stripe moves
 * the whole charge to the merchant and debits its processing fee from the
 * PLATFORM's balance. Aglyn's net on an order is therefore
 *
 *     application_fee_amount − (processing% × charge + 30¢)
 *
 * and with `application_fee_amount` at 0 — which is what
 * `transactionFeePhysicalPct: 0` produced on Pro, Business, Scale, Advanced,
 * Agency and Enterprise — that net is NEGATIVE on every single sale. A flat
 * percentage cannot repair it either: Starter's 2% is below even the cheapest
 * processing rate, so Starter lost money at every order size too, and any rate
 * above it still loses until the order clears `30¢ ÷ (take − processing)`. The
 * fixed 30¢ is why a percentage alone can never reach break-even on small
 * orders, and why this returns a CENTS amount rather than a rate.
 *
 * WHY THE DEAREST METHOD AND NOT 2.9%. The shopper picks how to pay AFTER the
 * session is created, and `application_fee_amount` is a fixed number Stripe
 * will not let us revise once the charge settles. No storefront path pins
 * `payment_method_types`, so the platform's payment method configuration
 * decides the set — and per AGL-2343 that configuration has `klarna` and
 * `affirm` on beside the card family. Pricing this at the card rate would be
 * wrong exactly on the orders where it cost the most, which is the same
 * reasoning `marketplaceBreakEvenUsd` already applies to the listing floor;
 * these are deliberately the SAME two constants so the two cannot drift.
 *
 * THE ONE-LINE LEVER. On a card-family order this over-recovers by the spread
 * between the two rates. Pinning `payment_method_types` on the storefront
 * sessions to the card family would make 2.9% the true binding rate, and
 * `STOREFRONT_PROCESSING_PERCENT` below is then the single identifier to
 * repoint. That is a product decision about which payment methods a storefront
 * offers, not this one; it is recorded on AGL-2152 and in the Pricing Decision
 * Log so it can be taken deliberately.
 */
// `STOREFRONT_PROCESSING_PERCENT` and `STOREFRONT_PROCESSING_FIXED_CENTS` are
// declared beside the marketplace processing constants they are defined from,
// further down this file — a `const` cannot be read before its declaration is
// evaluated, and this function is only ever CALLED, never evaluated at import.
export function storefrontProcessingCostCents(chargeCents: number): number {
  if (!Number.isFinite(chargeCents) || chargeCents <= 0) return 0
  return (
    Math.ceil((chargeCents * STOREFRONT_PROCESSING_PERCENT) / 100) +
    STOREFRONT_PROCESSING_FIXED_CENTS
  )
}

/**
 * The Stripe Connect `application_fee_amount` for ONE storefront sale
 * (AGL-2152) — the platform's advertised take PLUS Stripe's processing cost,
 * passed through at cost.
 *
 *     fee = take%(feeBaseCents) + processing%(chargeCents) + 30¢
 *
 * so Aglyn's net per order is AT LEAST the advertised take, at every order
 * size down to Stripe's own 50¢ charge minimum, and never negative. The
 * September-1 price lock was lifted for this one change; see the Pricing
 * Decision Log entry of 2026-08-19. No advertised PLATFORM rate moved — a 0% tier is still 0%
 * platform take — what changed is that the card cost stops being absorbed
 * silently by Aglyn.
 *
 * `feeBaseCents` is the GOODS the take is a cut of (discounts already applied,
 * tax and shipping excluded — that has always been the basis, AGL-2317).
 * `chargeCents` is what Stripe will actually run the card for, which is goods
 * + tax + shipping, and defaults to `feeBaseCents` for the paths where they
 * are the same number. Passing the goods figure for a charge that also carries
 * tax would under-recover by the processing rate on the difference.
 *
 * Clamped to `chargeCents` because Stripe rejects an application fee larger
 * than the charge. That clamp can only bind below ~32¢, under Stripe's own 50¢
 * charge minimum, so it never trims a real order's fee.
 */
export function resolveTransactionFeeCents(
  org: Partial<AglynOrgBilling> | null | undefined,
  productType: 'physical' | 'digital' | 'service',
  feeBaseCents: number,
  chargeCents: number = feeBaseCents,
): number {
  const charge =
    Number.isFinite(chargeCents) && chargeCents > 0 ? Math.round(chargeCents) : 0
  if (charge <= 0) return 0
  const base =
    Number.isFinite(feeBaseCents) && feeBaseCents > 0
      ? Math.round(feeBaseCents)
      : 0
  const pct = resolveTransactionFeePct(org, productType)
  // The `Math.max(1, …)` every door already applied: a rate above zero on
  // goods the shopper pays for is a fee however small it rounds to.
  const take = pct > 0 && base > 0 ? Math.max(1, Math.round((base * pct) / 100)) : 0
  return Math.min(charge, take + storefrontProcessingCostCents(charge))
}

/**
 * Platform take rate % for a MARKETPLACE listing sale (AGL-1543), priced
 * off the SELLER org. Resolved through `resolveOrgEntitlements` — so a
 * dead subscription prices as free-plan (30%) even while the stale `plan`
 * field still names a paid tier, and a negotiated per-org
 * `entitlements.marketplaceFeePct` override wins over the plan default.
 * Resolve per request from the org doc; never cache the answer.
 *
 * An out-of-range or missing value falls back to the FREE-plan rate — the
 * conservative direction. A malformed override must never zero the
 * platform's cut.
 */
export function resolveMarketplaceFeePct(
  org: Partial<AglynOrgBilling> | null | undefined,
): number {
  const pct = resolveOrgEntitlements(org).marketplaceFeePct
  return Number.isFinite(pct) && pct >= 0 && pct <= 100
    ? pct
    : PLAN_ENTITLEMENTS.free.marketplaceFeePct
}

/**
 * The marketplace take rate that breaks even LATEST, derived from the plan
 * table rather than copied from it (AGL-2343).
 *
 * The lowest rate is the binding one: a smaller cut of the same price against
 * the same processing cost needs a dearer listing to cover it, so advice quoted
 * at this band holds for every publisher on every plan. Derived on each call
 * because a hand-written second copy of a rate is exactly the artifact that
 * decays into wrong money copy shown to a publisher — the same reason
 * `planGrantingFeature` reads the table instead of a map.
 */
export function bindingMarketplaceFeePct(): number {
  return Math.min(
    ...Object.values(PLAN_ENTITLEMENTS)
      .map((plan) => plan.marketplaceFeePct)
      .filter((pct) => Number.isFinite(pct) && pct > 0),
  )
}

/**
 * What one marketplace sale costs the PLATFORM to process (AGL-2343).
 *
 * NONE OF THESE IS AN AGLYN PRICE. They are Stripe's published US rates and
 * the Texas rate the platform remits, and they exist only as inputs to a
 * figure shown to a publisher while they type. Nothing is billed from them —
 * the charged amounts are `resolveMarketplaceFeePct` and Stripe's own
 * invoicing — so changing one changes a sentence, never a bill.
 *
 * WHY THE PLATFORM PAYS THE PROCESSING FEE AT ALL. Marketplace checkout is a
 * DESTINATION charge with a fixed `transfer_data[amount]` and deliberately no
 * `application_fee_amount`, so that the sales tax stays with the platform that
 * owes it (AGL-1544). On a destination charge Stripe debits its fee from the
 * PLATFORM's balance, and it is charged on `amount_total` — the listing price
 * plus the tax added on top of it.
 *
 * So a $1 listing at a 20% take rate is a loss: the buyer pays $1.08, the
 * seller is transferred $0.80, $0.08 is owed to the state, Aglyn keeps $0.20
 * and pays Stripe about $0.33. Net −$0.13.
 *
 * THE BNPL RATE IS THE ONE THAT BINDS, and it is not hypothetical: the live
 * default payment method configuration has `klarna` and `affirm` enabled
 * alongside `card`, `cashapp`, `link`, `amazon_pay` and `apple_pay`, and the
 * marketplace session pins no `payment_method_types`, so a buyer may pay by
 * either. Break-even is computed from the dearest enabled method, because a
 * figure computed from the cheapest would be wrong exactly when it mattered.
 * IF BNPL IS EVER TURNED OFF FOR MARKETPLACE SESSIONS, this constant is what
 * has to move with it.
 */
export const MARKETPLACE_PROCESSING_PERCENT_CARD = 2.9
/** Klarna/Affirm, roughly. See the note above — this is the binding one. */
export const MARKETPLACE_PROCESSING_PERCENT_BNPL = 6
/** Stripe's per-transaction fixed component, in cents. */
export const MARKETPLACE_PROCESSING_FIXED_CENTS = 30
/**
 * The tax rate the break-even figure assumes. Tax is added ON TOP of the
 * listing price and enlarges the base Stripe charges its percentage against,
 * so it makes the platform's cost slightly worse; the real rate is whatever
 * `automatic_tax` computes for the buyer's address, and this is the
 * platform's own Texas rate as a representative figure.
 */
export const MARKETPLACE_ASSUMED_TAX_PERCENT = 8.25

/**
 * The processing rate a STOREFRONT destination charge is priced against
 * (AGL-2152), and the one identifier to repoint if the storefront's payment
 * method set changes.
 *
 * Deliberately its OWN name rather than a direct use of the marketplace
 * constants, while being defined as one of them: the two surfaces share
 * Stripe's published rates and today share the platform's payment method
 * configuration, but they are separate product decisions. A future choice to
 * pin `payment_method_types` on storefront sessions to the card family — and
 * so to recover at `MARKETPLACE_PROCESSING_PERCENT_CARD` — must not silently
 * lower the marketplace listing floor, which is derived from the same figure
 * for a different flow.
 */
export const STOREFRONT_PROCESSING_PERCENT = MARKETPLACE_PROCESSING_PERCENT_BNPL
/** Stripe's per-transaction fixed component, in cents. Not rate-dependent. */
export const STOREFRONT_PROCESSING_FIXED_CENTS =
  MARKETPLACE_PROCESSING_FIXED_CENTS

/** Where the money goes on one sale of a paid listing (AGL-2343). */
export interface MarketplaceSaleEconomics {
  /** The listing price. */
  priceCents: number
  /** Added on top, and owed to the state. */
  taxCents: number
  /** What the buyer is charged. */
  buyerPaysCents: number
  /** `transfer_data[amount]` — the seller's share of the pre-tax price. */
  sellerReceivesCents: number
  /** The platform's take. */
  platformFeeCents: number
  /** Stripe's fee, debited from the platform on a destination charge. */
  processingCents: number
  /** `platformFeeCents - processingCents`. Negative is a loss on the sale. */
  platformNetCents: number
}

/**
 * The funds flow for one sale, mirroring what `checkout.ts` actually builds
 * (AGL-2343): tax exclusive and on top, a fixed transfer of the seller's share
 * of the PRE-tax price, and Stripe's fee charged on the buyer's total.
 */
export function marketplaceSaleEconomics(
  priceUsd: number,
  feePercent: number,
  processingPercent: number = MARKETPLACE_PROCESSING_PERCENT_BNPL,
): MarketplaceSaleEconomics {
  const priceCents = Math.max(0, Math.round(priceUsd * 100))
  const taxCents = Math.round(
    (priceCents * MARKETPLACE_ASSUMED_TAX_PERCENT) / 100,
  )
  const buyerPaysCents = priceCents + taxCents
  const platformFeeCents = Math.round((priceCents * feePercent) / 100)
  const sellerReceivesCents = priceCents - platformFeeCents
  // A zero-price listing takes no payment at all, so there is no fee to pay.
  const processingCents =
    priceCents === 0
      ? 0
      : Math.round(
          (buyerPaysCents * processingPercent) / 100 +
            MARKETPLACE_PROCESSING_FIXED_CENTS,
        )
  return {
    priceCents,
    taxCents,
    buyerPaysCents,
    sellerReceivesCents,
    platformFeeCents,
    processingCents,
    platformNetCents: platformFeeCents - processingCents,
  }
}

/**
 * The cheapest WHOLE-DOLLAR price at which the platform does not lose money on
 * a sale (AGL-2343).
 *
 * Whole dollars because every publish route rounds `priceUsd` to one, so a
 * fractional break-even is not a price anyone can actually set. Searched
 * rather than solved algebraically so that it can never disagree with
 * `marketplaceSaleEconomics` — the rounding in there is what decides the
 * answer at these amounts, and a closed form would drift from it silently.
 *
 * THIS IS THE ENFORCED FLOOR: `marketplaceMinPriceUsd` returns this figure
 * and every publish door refuses a paid listing under it. Recorded in the Pricing
 * Decision Log and on AGL-2343.
 */
export function marketplaceBreakEvenUsd(
  feePercent: number = bindingMarketplaceFeePct(),
  processingPercent: number = MARKETPLACE_PROCESSING_PERCENT_BNPL,
): number {
  // The listing price ceiling is the marketplace plugin's
  // `MARKETPLACE_MAX_PRICE_USD`, which this library may not import (an app-tier
  // lib cannot depend on an addon). The loop only needs SOME bound, and the
  // answer is single digits at every rate the table holds, so a generous local
  // one costs nothing and cannot drift into a wrong figure.
  const searchCeilingUsd = 1000
  for (let priceUsd = 1; priceUsd <= searchCeilingUsd; priceUsd += 1) {
    if (
      marketplaceSaleEconomics(priceUsd, feePercent, processingPercent)
        .platformNetCents >= 0
    ) {
      return priceUsd
    }
  }
  return searchCeilingUsd
}

/**
 * THE MINIMUM PRICE a paid marketplace listing may carry (AGL-2343).
 *
 * The floor is not a chosen round number — it is the break-even price itself,
 * the
 * cheapest whole dollar at which `marketplaceSaleEconomics` stops returning a
 * negative platform net, computed at the take rate that breaks even LATEST and
 * the dearest payment method the live configuration enables. Today that is $3.
 *
 * DERIVED, NEVER RESTATED. A second hand-written copy of this number in a
 * publish route or a form is the artifact that decays into a route refusing a
 * price a form invited, so both the server-side validator
 * (`MARKETPLACE_MIN_PRICE_USD` in the marketplace model) and every price field
 * read this. If the payment method set changes, or the plan table's lowest
 * take rate moves, the floor moves with them on the next call.
 *
 * ZERO IS NOT BELOW THE FLOOR. A free listing takes no payment at all, so it
 * costs nothing to process; the floor is a minimum on PAID listings only.
 */
export function marketplaceMinPriceUsd(): number {
  return marketplaceBreakEvenUsd()
}

/**
 * Whether a price is a PAID price that the floor refuses (AGL-2343) — the one
 * predicate a form uses to mark its price field in error and hold its publish
 * button, so that the button and the server agree about what is publishable.
 *
 * Rounds first because every publish route does, and a form's value is a
 * string mid-type: `'2.6'` is stored as $3 and must read as allowed here, or
 * the button would refuse a price the route accepts.
 */
export function isBelowMarketplacePriceFloor(priceUsd: unknown): boolean {
  const price = Math.round(Number(priceUsd) || 0)
  return price > 0 && price < marketplaceMinPriceUsd()
}

/**
 * The sentence a publish form shows under its price field when the price is
 * below the floor (AGL-2343), or `undefined` when there is nothing to say.
 *
 * NOT ADVISORY ANY MORE. The same figure is enforced by every publish route
 * through `publishPreconditionRefusal`, so this text has to read as a
 * requirement rather than a warning — a publisher who is told "consider
 * raising it" and then refused has been lied to by the form. It still explains
 * WHY, because a bare minimum with no arithmetic behind it reads as an
 * arbitrary tax on cheap listings.
 *
 * Shared by every publish form rather than written into each, because the
 * figure has to be the same one in all of them and the wording is the only
 * place a publisher ever sees it.
 *
 * Quoted at the take rate that breaks even LATEST, so the sentence holds for a
 * free-plan publisher too.
 */
export function marketplacePriceCostNote(
  priceUsd: unknown,
): string | undefined {
  const price = Math.round(Number(priceUsd) || 0)
  const minimum = marketplaceMinPriceUsd()
  // A free listing takes no payment, so it costs nothing to process and has
  // nothing to warn about — silence there is the point, not an oversight.
  if (!isBelowMarketplacePriceFloor(price)) return undefined
  const { processingCents, platformFeeCents } = marketplaceSaleEconomics(
    price,
    bindingMarketplaceFeePct(),
  )
  const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`
  return (
    `Too low to publish. Processing a $${price} payment costs about ` +
    `${usd(processingCents)}, more than the ${usd(platformFeeCents)} platform ` +
    `fee — the sale would lose money. The minimum paid price is ` +
    `$${minimum}, and a free listing ($0) takes no payment at all.`
  )
}

/**
 * The standing helper sentence a price field shows when there is nothing wrong
 * (AGL-2343): the minimum stated up front, so a publisher meets it while
 * typing instead of discovering it as a refusal.
 *
 * A capability that is not surfaced in the console does not count as shipped,
 * and that applies to a REFUSAL as much as to a feature: a floor only a route
 * knows about is a trap.
 *
 * @param suffix whatever else that particular form needs to say, appended.
 */
export function marketplacePriceFloorHint(suffix?: string): string {
  return (
    `0 for free, or $${marketplaceMinPriceUsd()} and up for a paid listing.` +
    (suffix ? ` ${suffix}` : '')
  )
}

/**
 * The cheapest plan whose BASE features include `feature`, in ladder order —
 * the answer to "which plan do I need for this?", which is the one thing an
 * upsell has to say and the one thing no gate can hard-code without drifting
 * from the table it is quoting.
 *
 * Returns `undefined` when NO plan carries it on the base tier. That is not
 * an error: `eventCalendar` is an add-on purchased through
 * `resolveOrgEntitlements`' override path and is false on all eight tiers, so
 * "upgrade to X" is the wrong sentence for it. Callers must handle undefined
 * rather than defaulting to a tier name.
 *
 * Derived from PLAN_ENTITLEMENTS on every call rather than from a
 * hand-written map: a table of "feature → plan" is exactly the artifact that
 * decays silently when a tier's flags are re-cut, and it would decay into
 * pricing copy shown to a customer.
 *
 * Ladder order is `SELF_SERVE_PLANS` then `enterprise` — the same order the
 * plan grid renders — so an enterprise-only feature (`ssoEnabled`) reports
 * Enterprise rather than nothing.
 */
export function planGrantingFeature(
  feature: keyof OrgFeatureFlags,
): OrgPlan | undefined {
  return [...SELF_SERVE_PLANS, 'enterprise' as OrgPlan].find((plan) =>
    Boolean(PLAN_ENTITLEMENTS[plan].features[feature]),
  )
}

/**
 * The plan name an upsell should name, ready to interpolate — "Business",
 * or undefined when {@link planGrantingFeature} has no answer.
 */
export function planLabelGrantingFeature(
  feature: keyof OrgFeatureFlags,
): string | undefined {
  const plan = planGrantingFeature(feature)
  return plan ? PLAN_LABELS[plan] : undefined
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
 * bake those in rather than carry a URL); the remaining text fields always
 * have a value so callers never string-concatenate `undefined`.
 *
 * `supportUrl` is nullable too, and it is the one field where null carries a
 * decision rather than an absence — see {@link resolveBrandingProfile}. A
 * caller must render NOTHING for it, never a placeholder and never a
 * substitute.
 */
export interface ResolvedBrandingProfile {
  productName: string
  logoUrl: string | null
  faviconUrl: string | null
  primaryColor: string | null
  supportUrl: string | null
  /**
   * The brand's own FRONT DOOR — where "Made with <product>" sends a visitor
   * who wants to know what built the site they are looking at.
   *
   * Deliberately separate from {@link ResolvedBrandingProfile.supportUrl},
   * which the badge used to borrow: a help-desk address is the wrong answer to
   * "what is this", and on this deployment it resolves to a `mailto:`, so the
   * badge opened a blank email instead of a web page.
   *
   * Nullable for the same reason `supportUrl` is — a brand with nowhere to
   * send that visitor gets a plain label, never a substitute destination.
   */
  homeUrl: string | null
  fromName: string
  emailLogoUrl: string | null
  customConsoleDomain: string | null
}

/**
 * The PLATFORM (non-white-label) brand — the fallback every surface gets when
 * an org lacks the `whiteLabel` entitlement, and the gap-filler for a partial
 * agency profile. Kept here beside the entitlement so brand and gate stay
 * reviewed together.
 *
 * Renamed from `AGLYN_BRANDING_PROFILE` (AGL-2153), and the rename is the
 * substance rather than tidying: the old name asserted *whose* brand this is,
 * and on a self-host install that assertion is exactly what stopped being
 * true. It is the platform's own brand, and which platform that is, is now
 * configuration.
 *
 * This one change reaches further than it looks. `resolveBrandingProfile` is
 * the single resolver EVERY branded surface routes through — console chrome,
 * published-site badge and title, transactional email — and this is its
 * fallback. Making the fallback read `platform-brand.ts` gives all of them a
 * self-host brand without extending the white-label machinery at all; only its
 * default needed to stop being a constant.
 */
export const PLATFORM_BRANDING_PROFILE: ResolvedBrandingProfile = {
  productName: PLATFORM_BRAND_NAME,
  // The platform's own surfaces still bake their logo in — this is here for
  // the surfaces that CANNOT, which is every surface rendered on somebody
  // else's site. The free-tier attribution badge is the one that exists
  // today, and it carried no mark at all while this was null.
  logoUrl: PLATFORM_MARK_URL,
  faviconUrl: null,
  primaryColor: null,
  supportUrl: PLATFORM_SUPPORT_URL,
  homeUrl: PLATFORM_HOME_URL,
  fromName: PLATFORM_BRAND_NAME,
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
  if (!checkEntitlement(org, 'whiteLabel')) return PLATFORM_BRANDING_PROFILE
  const profile = (org?.brandingProfile ?? {}) as OrgBrandingProfile
  return {
    productName:
      cleanBrandString(profile.productName) ??
      PLATFORM_BRANDING_PROFILE.productName,
    // NO FALLBACK — and this became load-bearing the moment
    // `PLATFORM_BRANDING_PROFILE.logoUrl` stopped being null. Inheriting it
    // would stamp the PLATFORM's mark on a white-label org's published sites,
    // which is precisely the disclosure white-label is sold to prevent. A
    // white-label org that set no logo shows none.
    logoUrl: cleanBrandString(profile.logoUrl) ?? null,
    faviconUrl:
      cleanBrandString(profile.faviconUrl) ?? PLATFORM_BRANDING_PROFILE.faviconUrl,
    primaryColor:
      cleanBrandString(profile.primaryColor) ??
      PLATFORM_BRANDING_PROFILE.primaryColor,
    // NO FALLBACK, and this is the one field that gets none (AGL-2428).
    //
    // Only a white-label org reaches this line — the guard above hands every
    // other org the platform profile whole. So a blank here belongs to an
    // organization whose transactional mail reads as *theirs* to a recipient
    // who is *their* customer, and filling the gap with Aglyn's desk sends
    // that person to a support team that cannot help them, while disclosing
    // a vendor they were never told about. `platform-brand.ts` calls the
    // same substitution in the self-host case "a trap dressed as a default";
    // this is that trap with a different victim.
    //
    // Blank therefore means NO LINK, exactly as `emailLogoUrl` one field
    // down already means no logo. An email with a gap where a link should be
    // reads as broken; an email with no support line reads as plain, which
    // is the right appearance for an organization that has not set one.
    supportUrl: cleanBrandString(profile.supportUrl) ?? null,
    // A white-label org has no separate "home" field to store, and the same
    // no-fallback rule applies for the same reason: `PLATFORM_HOME_URL` here
    // would put a link to the platform's marketing site on the badge of an
    // org that pays to conceal the platform exists. Their support URL is the
    // only destination they have told us about, which is exactly what this
    // badge already linked to before the split — so white-label badges are
    // unchanged, and only the platform's own badge stops opening a mail
    // client.
    homeUrl: cleanBrandString(profile.supportUrl) ?? null,
    fromName:
      cleanBrandString(profile.fromName) ?? PLATFORM_BRANDING_PROFILE.fromName,
    emailLogoUrl:
      cleanBrandString(profile.emailLogoUrl) ??
      PLATFORM_BRANDING_PROFILE.emailLogoUrl,
    customConsoleDomain:
      cleanBrandString(profile.customConsoleDomain) ??
      PLATFORM_BRANDING_PROFILE.customConsoleDomain,
  }
}

/**
 * The brand as MERGE TOKENS, for a staff-designed system-email template
 * (AGL-2139).
 *
 * White-label inverted precisely when staff published a template, which is
 * that feature's normal steady state. Every org-context sender has the shape
 * `subject: designed?.subject ?? <branded fallback>` — the DESIGNED template
 * wins — and the catalog copy hard-coded "Aglyn" throughout. There was no
 * brand token to design against either: the merge maps carried `org.name`,
 * `invite.role`, `signInUrl` and friends and nothing about the brand, and
 * `blankUnresolvedTokens` BLANKS any token the caller did not supply. So a
 * designer who reached for `{{brand.productName}}` would have shipped an
 * email with a hole in the sentence.
 *
 * Token bodies are namespaced `brand.*` so a designer can tell them from the
 * per-send values, and they resolve for EVERY org — Aglyn's own included,
 * since `PLATFORM_BRANDING_PROFILE.productName` is `'Aglyn'`. That is what makes
 * a single template correct for both populations instead of one hard-coded
 * for the majority.
 *
 * The email LOGO is deliberately absent. It is structural — `renderEmailHtml`
 * emits it as a header row above the designed body, or emits nothing — so it
 * travels as an option rather than as a token a template could forget to
 * place, and there is no sample URL a staff test-send could render without
 * showing a broken image.
 */
export function brandMergeTokens(
  branding: ResolvedBrandingProfile,
): Record<string, string> {
  return {
    'brand.productName': branding.productName,
    'brand.fromName': branding.fromName,
    // EMPTY, never omitted, when the org has no Support URL (AGL-2428).
    //
    // `renderLoadedSystemEmail` merges these OVER `DEFAULT_BRAND_TOKENS`,
    // which carries the platform's own support URL for the genuinely
    // org-less senders. Dropping the key here would let that default show
    // through and mail a white-label org's customer a link to Aglyn — the
    // exact leak this closes — so the key must be present and empty in order
    // to overwrite it. A designed template that interpolates the token
    // renders nothing where it sits.
    'brand.supportUrl': branding.supportUrl ?? '',
  }
}

/**
 * The value of the `<meta name="generator">` tag and of the `x-powered-by`
 * header on published sites (AGL-2088) — the canonical CMS signal WordPress,
 * Squarespace, Drupal and Ghost all ship, and the thing tech-stack detectors
 * key on.
 *
 * Deliberately VERSIONLESS. The accidental headers this replaced carried
 * `1.0.0-alpha.0` and a Node version, which dated every deployment and named
 * our runtime to no consumer. A detector needs the product name and nothing
 * else.
 */
export const PLATFORM_GENERATOR_NAME = PLATFORM_BRAND_NAME

/**
 * May this org's published pages say they were built with Aglyn? (AGL-2088)
 *
 * The gate for the `<meta name="generator">` tag and the `x-powered-by`
 * header. It reads the SAME entitlement `resolveBrandingProfile` reads —
 * `whiteLabel` — rather than inventing a parallel one, so an agency's
 * concealment promise has exactly one definition.
 *
 * WHY `whiteLabel` AND NOT `showBranding`. The "Made with Aglyn" badge is
 * gated on `removeBranding`, which every plan above free grants, so reusing
 * that gate would confine the signal to free-tier sites — the corpus this
 * exists to build would be almost empty on day one. The two promises are also
 * different in kind: `removeBranding` buys a page with no Aglyn credit on it,
 * an aesthetic commitment about what a VISITOR sees; `whiteLabel` buys
 * concealment of who built the site, which is the promise a machine-readable
 * fingerprint actually breaks. A paying customer on a mid plan has bought a
 * clean page, not anonymity.
 *
 * ⚠️ AN UNRESOLVED ORG SUPPRESSES, and this is the whole reason the function
 * exists instead of a bare `!checkEntitlement(org, 'whiteLabel')` at each call
 * site. `resolveOrgEntitlements(null)` resolves to the FREE plan — a loading
 * default answering a question it was never asked — so a null org reads as
 * "no white-label" and would EMIT. That null is not hypothetical: the tenant's
 * `getOrgBilling` fails open with `org: null` on a Firestore error, so a
 * transient read failure on an Agency site would have stamped the generator
 * tag onto it. The asymmetry decides the direction: suppressing wrongly costs
 * us one detection sample, emitting wrongly breaks a paid promise on a
 * customer's own domain. So the org must be PRESENT and lack the entitlement;
 * absent is not the same as free here.
 */
export function showsPlatformAttribution(
  org: Partial<AglynOrgBilling> | null | undefined,
): boolean {
  // `{}` is treated as unresolved alongside `null`, and that is not
  // pedantry: no org doc that was actually READ is empty — the converter
  // yields `$id` at minimum — so an empty object only ever arrives from a
  // placeholder or a loading default, the same shape `useBranding` hands back
  // before its read lands. It resolves to the free plan like every other
  // absent org, which is the right default for a quota and the wrong one for
  // a disclosure.
  if (!org || Object.keys(org).length === 0) return false
  return !checkEntitlement(org, 'whiteLabel')
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
 *
 * SINCE AGL-2439 THIS IS THE PLAN'S CAP FOR `members`, with no purchased
 * seats in it — see the comment at the add below. A per-site answer must come
 * from `checkHostCollaboratorQuota(org, hostId, used)`, which is the only
 * thing that knows which site holds which pool seat. Every caller that has a
 * `hostId` must use that one; this stays correct for a plan-level readout
 * (what the plan includes per site, before anything is assigned).
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
  // `members` IS NOT ADDED HERE, and this is the fix, not an omission
  // (AGL-2439) — the AGL-1775 shape, applied to
  // the key that never got it. `seatAddons.members` is an ORG-LEVEL purchased
  // quantity and `membersPerHost` is enforced PER SITE, so folding one into
  // the other handed every site the whole purchase: an org with 20 sites that
  // bought ONE extra collaborator seat received 20 seats for one seat's price.
  // The quantity is now a POOL and `org.collaboratorAllocations` says which
  // site holds each seat. What this function returns for `members` is
  // therefore **the plan's cap alone** — exactly what an unallocated site must
  // resolve to. Per-site capacity comes from `checkHostCollaboratorQuota`;
  // nothing else may add the pool back in.
  //
  // `managers` is unaffected and still adds: `managersPerOrg` really is
  // org-level, so an org-level purchase raising an org-level cap is correct
  // there. That difference is the whole reason this is a `kind` switch rather
  // than one rule.
  const purchased =
    kind === 'managers'
      ? Math.max(0, resolvePurchasedAddons(org)[kind] ?? 0)
      : 0
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
 * Volume above the plan's included band, in emails.
 *
 * Transactional mail is never refused, so an org CAN and will finish a month
 * over its included allowance. That is not an error and not a failed send —
 * it is the overage the cap chose not to enforce, and recording it is what
 * keeps it from being a surprise at invoicing. `UNLIMITED` (and any
 * non-positive limit, which is how "no included allowance" is expressed)
 * yields 0 rather than the whole month's volume.
 *
 * DEFINED HERE and re-exported from `email-metering.ts` (AGL-2155's move):
 * the billing page renders this figure before anything is invoiced, and it
 * is a client component that cannot pull in the Admin SDK. One subtraction,
 * so the readout and the invoice cannot disagree.
 */
export function emailSendsOverage(total: number, limit: number): number {
  const sends = Number(total)
  const included = Number(limit)
  if (!Number.isFinite(sends) || sends <= 0) return 0
  if (!Number.isFinite(included) || included <= 0) return 0
  return Math.max(0, sends - included)
}

export interface EmailSendOveragePrice {
  /** Emails past the plan's included band, as handed in. */
  overageSends: number
  /** Estimated charge this month at the plan's per-1,000 rate. */
  overageMonthlyUsd: number
  /** Per-1,000 rate; null when the plan carries no email overage price. */
  overageRateUsd: number | null
}

/**
 * Prices email volume past a plan's included band.
 *
 * ## No `allowed`, deliberately
 *
 * Every other meter's helper here answers "may this proceed" alongside "what
 * does it cost", because on those axes one gate decides both. Email has two
 * gates that are not the same gate: `reserveCampaignEmailSends` refuses a
 * CAMPAIGN at the band inside a transaction, and nothing at all refuses
 * transactional mail at any tier. A field named `allowed` on this result
 * would be a plausible-looking thing for a sender to consult, and a
 * transactional sender consulting it is how a password reset stops going out.
 * So the result carries money and nothing else.
 *
 * ## Takes the overage, does not recompute it
 *
 * `emailSendsOverage` already derives the excess from the cost meter and the
 * resolved band, on the path that records it. Re-deriving it here from a raw
 * total would be a second overage model to drift from the first — which is
 * the shape AGL-1402 documented, where two figures that should have been one
 * disagreed by 20-45% for years.
 *
 * A null rate yields zero, structurally rather than by a check, which is what
 * keeps free at zero on this axis for the same reason it is zero on the other
 * three.
 */
export function priceEmailSendOverage(
  org: Partial<AglynOrgBilling> | null | undefined,
  overageSends: number,
): EmailSendOveragePrice {
  const overageRateUsd = PLAN_PRICING[resolvePlan(org)].extraEmailSendsUsdPer1k
  const sends = Number(overageSends)
  const over = Number.isFinite(sends) && sends > 0 ? sends : 0
  return {
    overageSends: over,
    overageMonthlyUsd:
      overageRateUsd === null
        ? 0
        : Math.round((over / 1000) * overageRateUsd * 100) / 100,
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

/**
 * How far past a plan's own included band the abuse ceiling sits (AGL-1655).
 * Ten times what the customer bought is not growth — a site that legitimately
 * outgrows its band by an order of magnitude has an upgrade conversation
 * waiting, not a silent invoice.
 */
export const FORM_ABUSE_CEILING_MULTIPLE = 10

/**
 * Absolute floor for the abuse ceiling, so the small plans get real headroom
 * rather than a second, tighter plan limit wearing a different name. Starter
 * includes 200/month; 10× would be 2,000, which a genuinely busy site could
 * reach. 5,000 is ~167 submissions a day on ONE site — no legitimate site on
 * a small plan reaches that, and no small customer can be billed past
 * 5,000 × $0.000065 ≈ $0.33 of abuse.
 */
export const FORM_ABUSE_CEILING_FLOOR = 5_000

/**
 * Ceiling for plans whose included count is UNLIMITED (Agency, Enterprise),
 * where a multiple has nothing to multiply. Kept at or above the ceiling of
 * every finite plan below it (Advanced includes 100,000 → 1,000,000) so the
 * ladder never inverts and a bigger plan never gets the smaller ceiling.
 */
export const FORM_ABUSE_CEILING_UNLIMITED = 1_000_000

export interface FormAbuseCeilingResult {
  /** True once this month's count for the SITE has reached the ceiling. */
  exceeded: boolean
  /** The ceiling this site's plan resolves to. Always finite. */
  ceiling: number
  used: number
}

/**
 * Per-site monthly abuse ceiling for form submissions (AGL-1655).
 *
 * Deliberately NOT part of `checkFormSubmissionQuota`. That function answers
 * a plan question — "did the customer buy this?" — and AGL-1280 correctly
 * made its answer on a metered plan always yes, because usage past the band
 * bills rather than blocks. This one answers a different question: "is this
 * still a customer's traffic at all?" Conflating them is how the plan gate
 * ended up as the anti-abuse control it was never designed to be, and how
 * `allowed: metered ? true : …` came to mean an unbounded bill.
 *
 * So the ceiling is containment, not capacity. It is far above anything a
 * legitimate site reaches, it is the same shape on every plan, and crossing
 * it is an INCIDENT: the caller is expected to refuse the write, leave the
 * billable counter alone, and make the trip visible to the site's managers
 * and to staff. A ceiling that silently absorbed submissions would only move
 * the free plan's lost-lead failure up to a bigger number.
 *
 * Evaluated against the same month counter the plan gate reads — which is
 * Admin-SDK-only (`counters` is excluded from every client write in
 * `cloud/firebase-firestore.rules`), so the count behind the ceiling cannot
 * be lowered to launder past it.
 */
export function checkFormSubmissionAbuseCeiling(
  org: Partial<AglynOrgBilling> | null | undefined,
  usedThisMonth: number,
): FormAbuseCeilingResult {
  const included = resolveOrgEntitlements(org).formSubmissionsPerMonth
  const ceiling = Number.isFinite(included)
    ? Math.max(FORM_ABUSE_CEILING_FLOOR, included * FORM_ABUSE_CEILING_MULTIPLE)
    : FORM_ABUSE_CEILING_UNLIMITED
  const used = Math.max(0, usedThisMonth)
  return { exceeded: used >= ceiling, ceiling, used }
}

/**
 * Average transfer per page view (HTML + JS + a few images), the constant
 * that turns the analytics view counter into a bandwidth number and back.
 *
 * Lives HERE rather than beside the metering rates (AGL-2155). It used to sit
 * in `apps/console/utils/usage-metering.ts`, which the console imports and the
 * tenant app cannot — and the bandwidth ceiling below has to be evaluated in
 * the tenant app, at the beacon that writes the counter. Re-deriving the
 * conversion there would have been a fourth hand-rolled copy of
 * `× 1024³ / 600KB`, which is the exact drift AGL-1371 collapsed into one
 * function. `usage-metering` now re-exports these three, so every existing
 * importer is unchanged and there is still one definition.
 */
export const ESTIMATED_PAGE_TRANSFER_BYTES = 600 * 1024

/**
 * Bandwidth ⇄ page views: the one conversion three surfaces used to each
 * write out by hand (AGL-1371).
 *
 * `bandwidthGb` is not a second cap next to metered page views — it IS the
 * included band of the page-view meter, expressed in the unit customers
 * understand. It is therefore used in both directions: forward by
 * `meteredIncludedAllowance` to size the band the invoice subtracts, backward
 * by the usage-alerts cron and the console meter to render live page views as
 * GB.
 */
export function pageViewsFromBandwidthGb(bandwidthGb: number): number {
  return (bandwidthGb * 1024 * 1024 * 1024) / ESTIMATED_PAGE_TRANSFER_BYTES
}

/** @see pageViewsFromBandwidthGb — the same constant, the other way. */
export function bandwidthGbFromPageViews(pageViews: number): number {
  return (
    (Math.max(0, Number(pageViews) || 0) * ESTIMATED_PAGE_TRANSFER_BYTES) /
    (1024 * 1024 * 1024)
  )
}

/**
 * How far past a plan's own included bandwidth the abuse ceiling sits
 * (AGL-2155) — the same posture, and the same number, as
 * {@link FORM_ABUSE_CEILING_MULTIPLE}. Ten times the bandwidth the customer
 * bought is not growth; it is an upgrade conversation, or it is not the
 * customer's traffic at all.
 */
export const BANDWIDTH_ABUSE_CEILING_MULTIPLE = 10

/**
 * Absolute floor for the bandwidth ceiling, in PAGE VIEWS per month, so the
 * small plans get real headroom instead of a second, tighter plan limit
 * wearing a different name.
 *
 * Free includes 5 GB ≈ 8,738 views; 10× would be ~87,381, which a genuinely
 * successful hobby site (a post that lands on Hacker News) reaches in an
 * afternoon and would be a miserable first experience of the platform.
 * 100,000 views/month ≈ 57.2 GB ≈ **$10 of real COGS** at
 * `METERED_UNIT_RATES_USD.perPageView` — an order of magnitude above the free
 * band, and an order of magnitude below the $100 a million views costs. It is
 * the number that makes "free stays free" true without making it stingy.
 */
export const BANDWIDTH_ABUSE_CEILING_FLOOR = 100_000

/**
 * Ceiling for plans whose bandwidth band is UNLIMITED (Enterprise), where a
 * multiple has nothing to multiply. Kept at or above the ceiling of every
 * finite plan below it — Agency includes 20,000 GB ≈ 35.0M views, so its
 * ceiling is ~350M — so the ladder never inverts and a bigger plan never
 * inherits a smaller ceiling.
 */
export const BANDWIDTH_ABUSE_CEILING_UNLIMITED = 500_000_000

/**
 * Machine-readable marker for a bandwidth containment, so a capped response
 * is distinguishable from the maintenance/lockdown notices it shares a shell
 * with. Deliberately NOT a {@link LockdownReasonCode}: a lockdown is a staff
 * takedown, this is a billing containment that clears itself at the month
 * boundary with nobody doing anything.
 */
export const BANDWIDTH_CEILING_CODE = 'bandwidth_ceiling'

export interface BandwidthAbuseCeilingResult {
  /** True once this month's page views for the SITE reached the ceiling. */
  exceeded: boolean
  /** The ceiling this site's plan resolves to, in page views. Finite. */
  ceiling: number
  used: number
}

/**
 * Per-site monthly bandwidth abuse ceiling (AGL-2155).
 *
 * ## The hole this closes
 *
 * Every other free dimension had a runtime brace — `mediaStorageGate`,
 * `checkFormSubmissionQuota`, a zero band for dataset storage and API, a
 * hard band for contacts. Bandwidth had **none**: nothing anywhere refused a
 * page view, so a free site that went viral served a million views — roughly
 * **$100 of real COGS** — with no wall, no throttle and no alert. It was
 * protected only by the structural zero on the billing side (free carries no
 * rate, so the invoice stays $0), which protects the *bill* and not the
 * *bleeding*. `free-tier-never-billed.spec.ts` said so in its own table.
 *
 * ## Why an abuse ceiling and not a plan gate
 *
 * Exactly the distinction {@link checkFormSubmissionAbuseCeiling} draws, and
 * for the same reason. A plan gate answers "did the customer buy this?" — and
 * for a metered plan the answer past the band is *yes, and we bill it*. This
 * answers "is this still a customer's traffic at all?", and crossing it is an
 * INCIDENT rather than a quota: the site is flagged, staff are told, and the
 * render path degrades to a static notice instead of paying ~40 Firestore
 * reads and ~600 KB of egress per view.
 *
 * ## Where it is evaluated
 *
 * NOT in the render path. The page-view counter is written *after* the render
 * by `/api/analytics/collect`; that route evaluates this on a sampled cadence
 * and stamps `bandwidthCeiling` onto the host document. The render path reads
 * that field off a host doc **it already loads** (`load-page-data.ts` reads
 * `hostRes.host` for the lockdown branch), so the containment costs the happy
 * path exactly zero extra reads.
 *
 * An edge/CDN rule would be the other natural home and is deliberately not
 * the answer here: it is not a repo change, nothing in this suite could
 * verify it, and it cannot see which plan a host is on.
 */
export function checkBandwidthAbuseCeiling(
  org: Partial<AglynOrgBilling> | null | undefined,
  usedPageViewsThisMonth: number,
): BandwidthAbuseCeilingResult {
  const includedGb = resolveOrgEntitlements(org).bandwidthGb ?? 0
  const includedViews = pageViewsFromBandwidthGb(includedGb)
  const ceiling = Number.isFinite(includedViews)
    ? Math.max(
        BANDWIDTH_ABUSE_CEILING_FLOOR,
        Math.round(includedViews * BANDWIDTH_ABUSE_CEILING_MULTIPLE),
      )
    : BANDWIDTH_ABUSE_CEILING_UNLIMITED
  const used = Math.max(0, Number(usedPageViewsThisMonth) || 0)
  return { exceeded: used >= ceiling, ceiling, used }
}

/**
 * Does crossing the ceiling **degrade what visitors see**, or only raise the
 * incident? (AGL-2155)
 *
 * Only on a plan that does NOT meter the infra pass-through — which today is
 * free/hobby, where the requirement is that free always actually stays free.
 * On free the traffic is uncompensated, so serving it is a
 * straight loss and the least destructive way to stop the bleeding is to stop
 * paying for the expensive render.
 *
 * On a metered plan the same traffic is *invoiced*, so taking a paying
 * customer's site off the air would trade a bill they agreed to for an outage
 * they did not. Their ceiling still trips, still flags the host and still
 * escalates to staff — it just does not change what a visitor gets. Whether a
 * paying host past its OWN ceiling should also be degraded is a product call
 * and is left open on purpose; flipping it is this one function.
 */
export function bandwidthCeilingDegradesRender(
  org: Partial<AglynOrgBilling> | null | undefined,
): boolean {
  return !planMetersInfraOverage(org)
}

/**
 * `hosts/{id}.bandwidthCeiling` — the flag the beacon stamps and the render
 * path reads. Month-scoped so it **self-clears at the month boundary** with
 * no staff action and no write, the same property `LockdownState.untilMs`
 * has: a site contained in August serves normally on September 1.
 *
 * Admin-SDK-only. It is frozen against client writes in
 * `cloud/firebase-firestore.rules` alongside the `suspendedAt` family, for
 * the identical reason: a site that could clear its own containment does not
 * have one.
 */
export interface HostBandwidthCeiling {
  /** `YYYY-MM` (UTC) the trip belongs to. */
  month: string
  /** The ceiling that was crossed, in page views. */
  ceiling: number
  /** The month count observed when it tripped. */
  used: number
  trippedAtMs: number
  /** False when the plan meters the overage — flagged, not degraded. */
  degraded: boolean
}

/**
 * Read the host document's containment flag, tolerantly. Returns null unless
 * the flag is present, well-formed AND belongs to `month` — an August trip
 * must not silence a September visitor.
 */
export function normalizeHostBandwidthCeiling(
  host: Record<string, any> | null | undefined,
  month: string,
): HostBandwidthCeiling | null {
  const raw = host?.['bandwidthCeiling']
  if (!raw || typeof raw !== 'object') return null
  if (String(raw.month ?? '') !== month) return null
  const ceiling = Number(raw.ceiling ?? 0)
  if (!Number.isFinite(ceiling) || ceiling <= 0) return null
  return {
    month,
    ceiling,
    used: Math.max(0, Number(raw.used ?? 0) || 0),
    trippedAtMs: Math.max(0, Number(raw.trippedAtMs ?? 0) || 0),
    degraded: raw.degraded === true,
  }
}

/**
 * Is the render path required to serve the capped notice instead of the page?
 *
 * Both halves must hold: the flag is for THIS month, and the trip was
 * recorded as one that degrades. `degraded` is written by the evaluator from
 * {@link bandwidthCeilingDegradesRender} at trip time rather than re-derived
 * here, so a host that upgrades mid-month is not still being degraded by a
 * flag written while it was free — and, in the other direction, a flag from a
 * paying host can never take that host down.
 */
export function bandwidthCeilingDegradesHost(
  host: Record<string, any> | null | undefined,
  month: string,
): boolean {
  return normalizeHostBandwidthCeiling(host, month)?.degraded === true
}

/** UTC `YYYY-MM`, the key both the beacon and the render path agree on. */
export function bandwidthCeilingMonthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7)
}

/**
 * Visitor-facing copy for a contained site. Says what happened and that it
 * ends, and names nothing about the plan, the count or the owner — this is
 * read by a stranger to the site, exactly like the form ceiling's refusal
 * body (AGL-1666).
 */
export function bandwidthCeilingNotice(): { title: string; body: string } {
  return {
    title: 'This site is temporarily unavailable',
    body: 'It has served more traffic this month than its plan includes. It will be back at the start of next month, or sooner if the owner upgrades.',
  }
}

/**
 * What a quota check costs a caller that intends to ENFORCE it (AGL-2163).
 *
 * `checkDataStorageQuota` and `checkApiRequestQuota` each carry an `allowed`
 * field, and their docblocks promise it refuses — "plans without one (free)
 * hard-block at the included size", "plans without API access have
 * `included: 0` and always block". Nothing read it. Both functions appeared
 * only in `/api/billing/report-usage`, which reads `overageMonthlyUsd` and
 * ignores `allowed`, so the promise was documentation and the free tier's
 * "runtime braces" on those two dimensions did not exist.
 *
 * Enforcing them naively means measuring first, and for dataset storage the
 * measurement is O(datasets) reads — far too much for a per-record write.
 * This makes the cheap answer available: for every plan shipping today the
 * verdict does not depend on the measurement at all, because a plan either
 * has an overage RATE (then it always allows and meters) or a band of zero
 * (then it always refuses). Measuring is required only for the shape a staff
 * `entitlementOverrides` can create — a finite, non-zero band on a plan with
 * no rate — and only then does the caller pay a read.
 *
 * - `'always-blocks'` — refuse now; no measurement, no read.
 * - `'never-blocks'` — proceed; no measurement, no read. **This is every
 *   metered/paid plan**, so enforcement costs a paying customer nothing and
 *   can never refuse them.
 * - `'measure'` — the verdict depends on usage; measure and call the check.
 */
export type QuotaEnforcementShape =
  | 'always-blocks'
  | 'never-blocks'
  | 'measure'

function enforcementShape(
  atZero: boolean,
  atCeiling: boolean,
): QuotaEnforcementShape {
  if (!atZero && !atCeiling) return 'always-blocks'
  if (atZero && atCeiling) return 'never-blocks'
  return 'measure'
}

/**
 * Enforcement shape of {@link checkDataStorageQuota} for this org, before
 * anything has been measured. @see QuotaEnforcementShape
 */
export function dataStorageEnforcementShape(
  org: Partial<AglynOrgBilling> | null | undefined,
): QuotaEnforcementShape {
  return enforcementShape(
    checkDataStorageQuota(org, 0).allowed,
    checkDataStorageQuota(org, Number.MAX_SAFE_INTEGER).allowed,
  )
}

/**
 * Enforcement shape of {@link checkApiRequestQuota} for this org, before
 * anything has been measured. @see QuotaEnforcementShape
 */
export function apiRequestEnforcementShape(
  org: Partial<AglynOrgBilling> | null | undefined,
): QuotaEnforcementShape {
  return enforcementShape(
    checkApiRequestQuota(org, 0).allowed,
    checkApiRequestQuota(org, Number.MAX_SAFE_INTEGER).allowed,
  )
}
