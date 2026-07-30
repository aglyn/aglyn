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
  AGLYN_BRANDING_PROFILE,
  checkApiRequestQuota,
  checkContactQuota,
  checkDataStorageQuota,
  checkDatasetQuota,
  checkDiscountMargin,
  checkEntitlement,
  isBillingSubscription,
  applyDiscountUsd,
  orgListPriceMonthlyUsd,
  orgMonthlyRevenueUsd,
  orgNetMonthlyRevenueUsd,
  netOfProcessorFee,
  INFRA_COGS_PER_SITE_USD,
  NET_MARGIN_FLOOR_PCT,
  resolveBrandingProfile,
  resolveEffectivePlan,
  checkQuota,
  checkSeatQuota,
  PLAN_ENTITLEMENTS,
  PLAN_PRICING,
  resolveOrgEntitlements,
  resolveTransactionFeePct,
  UNLIMITED,
} from './plan-entitlements'
import type { OrgPlan } from '../foundation'

describe('plan entitlements', () => {
  it('resolves missing/unknown plans as free', () => {
    expect(resolveOrgEntitlements(undefined).hostLimit).toBe(1)
    expect(resolveOrgEntitlements({ plan: 'nope' as any }).hostLimit).toBe(1)
    expect(checkEntitlement(null, 'versioning')).toBe(false)
  })

  it('resolves plan defaults', () => {
    expect(checkEntitlement({ plan: 'pro' } as any, 'versioning')).toBe(true)
    expect(checkEntitlement({ plan: 'starter' } as any, 'versioning')).toBe(
      false,
    )
    expect(
      checkEntitlement({ plan: 'starter' } as any, 'reusableComponents'),
    ).toBe(true)
  })

  it('applies per-org overrides key-by-key', () => {
    const org = {
      plan: 'free',
      entitlements: { hostLimit: 10, features: { versioning: true } },
    } as any
    const resolved = resolveOrgEntitlements(org)
    expect(resolved.hostLimit).toBe(10)
    expect(resolved.features.versioning).toBe(true)
    // untouched defaults survive
    expect(resolved.screensPerHost).toBe(5)
    expect(resolved.features.customDomain).toBe(false)
  })

  it('checkQuota gates at the limit and never reports negative remaining', () => {
    const org = { plan: 'free' } as any
    expect(checkQuota(org, 'hostLimit', 0)).toEqual({
      allowed: true,
      limit: 1,
      remaining: 1,
    })
    expect(checkQuota(org, 'hostLimit', 1).allowed).toBe(false)
    expect(checkQuota(org, 'hostLimit', 5).remaining).toBe(0)
  })

  it('pins the AGL-67 tier table', () => {
    expect(
      Object.fromEntries(
        Object.entries(PLAN_ENTITLEMENTS).map(([plan, value]) => [
          plan,
          [value.hostLimit, value.screensPerHost, value.sharedLayoutsPerHost],
        ]),
      ),
    ).toEqual({
      free: [1, 5, 1],
      starter: [1, 25, 3],
      pro: [3, 100, UNLIMITED],
      business: [10, UNLIMITED, UNLIMITED],
      scale: [15, UNLIMITED, UNLIMITED],
      advanced: [25, UNLIMITED, UNLIMITED],
      agency: [100, UNLIMITED, UNLIMITED],
    })
    // Media storage exceeds the published-site cap by design (AGL-67).
    for (const plan of Object.values(PLAN_ENTITLEMENTS)) {
      expect(plan.storagePerHostMb).toBeGreaterThan(plan.totalSiteSizeMb)
    }
    expect(PLAN_ENTITLEMENTS.starter.features.removeBranding).toBe(true)
    // White-label (White-Label Phase 1): Agency tier only; every other tier
    // — including Advanced — is off by default. Distinct from removeBranding,
    // which paid tiers all carry.
    expect(PLAN_ENTITLEMENTS.agency.features.whiteLabel).toBe(true)
    for (const plan of Object.keys(PLAN_ENTITLEMENTS) as OrgPlan[]) {
      if (plan === 'agency') continue
      expect(PLAN_ENTITLEMENTS[plan].features.whiteLabel).toBe(false)
    }
    expect(PLAN_ENTITLEMENTS.pro.features.marketplaceSelling).toBe(true)
    expect(PLAN_ENTITLEMENTS.pro.features.scheduledPublishing).toBe(false)
    expect(PLAN_ENTITLEMENTS.business.features.scheduledPublishing).toBe(true)
    // Builder gating (AGL-99): paid tiers unlock workflows/datasets, free
    // keeps a taste of variables/functions only.
    expect(PLAN_ENTITLEMENTS.free.workflowsPerHost).toBe(0)
    expect(PLAN_ENTITLEMENTS.free.datasetsPerOrg).toBe(0)
    expect(PLAN_ENTITLEMENTS.free.features.workflows).toBe(false)
    expect(PLAN_ENTITLEMENTS.starter.variablesPerHost).toBe(25)
    expect(PLAN_ENTITLEMENTS.starter.features.dataStore).toBe(true)
    expect(PLAN_ENTITLEMENTS.pro.functionsPerHost).toBe(50)
    expect(PLAN_ENTITLEMENTS.business.recordsPerDataset).toBe(100000)
    // CDN media delivery (AGL-175): paid tiers only; free serves raw URLs.
    expect(PLAN_ENTITLEMENTS.free.features.mediaCdn).toBe(false)
    expect(PLAN_ENTITLEMENTS.starter.features.mediaCdn).toBe(true)
    expect(PLAN_ENTITLEMENTS.business.features.mediaCdn).toBe(true)
  })

  it('includes basic interactions on every plan while gating actions (AGL-577)', () => {
    // Basic presentational interactions (menu/drawer/show-hide) ship on
    // every tier; the powerful automations stay behind `actions`.
    for (const plan of Object.values(PLAN_ENTITLEMENTS)) {
      expect(plan.features.interactions).toBe(true)
    }
    expect(PLAN_ENTITLEMENTS.free.features.actions).toBe(false)
    expect(PLAN_ENTITLEMENTS.starter.features.actions).toBe(false)
    expect(PLAN_ENTITLEMENTS.pro.features.actions).toBe(true)
    expect(PLAN_ENTITLEMENTS.business.features.actions).toBe(true)
  })

  it('treats UNLIMITED quotas as always allowed', () => {
    const org = { plan: 'business' } as any
    const result = checkQuota(org, 'screensPerHost', 100000)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(UNLIMITED)
  })

  it('pins the AGL-278 pricing model (Squarespace/Shopify parity)', () => {
    expect(PLAN_PRICING).toEqual({
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
      },
    })
  })

  it('pins the AGL-112 seat table', () => {
    expect(
      Object.fromEntries(
        Object.entries(PLAN_ENTITLEMENTS).map(([plan, value]) => [
          plan,
          [
            value.managersPerOrg,
            value.maxManagersPerOrg,
            value.membersPerHost,
            value.maxMembersPerHost,
          ],
        ]),
      ),
    ).toEqual({
      free: [1, 1, 1, 1],
      starter: [2, 5, 3, 10],
      pro: [5, 20, 10, 25],
      advanced: [50, 250, 100, 250],
      business: [15, 100, 50, 100],
      scale: [25, 150, 75, 150],
      agency: [100, 500, 250, 1000],
    })
  })

  it('checkSeatQuota counts purchased addons up to the hard max', () => {
    const base = checkSeatQuota({ plan: 'starter' } as any, 'managers', 2)
    expect(base.allowed).toBe(false)
    expect(base.limit).toBe(2)
    expect(base.upgradeRequired).toBe(false)
    expect(base.addonPriceUsd).toBe(5)

    const withAddons = checkSeatQuota(
      { plan: 'starter', seatAddons: { managers: 2 } } as any,
      'managers',
      2,
    )
    expect(withAddons.allowed).toBe(true)
    expect(withAddons.limit).toBe(4)
    expect(withAddons.purchased).toBe(2)

    // Addons clamp at the hard max; only an upgrade raises it further.
    const capped = checkSeatQuota(
      { plan: 'starter', seatAddons: { managers: 50 } } as any,
      'managers',
      4,
    )
    expect(capped.limit).toBe(5)
    expect(capped.maxSeats).toBe(5)
    expect(capped.upgradeRequired).toBe(true)
  })

  it('checkSeatQuota requires upgrading on plans without seat addons', () => {
    const result = checkSeatQuota({ plan: 'free' } as any, 'members', 1)
    expect(result.allowed).toBe(false)
    expect(result.upgradeRequired).toBe(true)
    expect(result.addonPriceUsd).toBeNull()
  })

  it('checkDatasetQuota counts purchased addon datasets up to the max (AGL-132/240)', () => {
    const org = { plan: 'starter', seatAddons: { datasets: 2 } } as any
    const quota = checkDatasetQuota(org, 4)
    expect(quota.limit).toBe(5)
    expect(quota.allowed).toBe(true)
    expect(checkDatasetQuota(org, 5).allowed).toBe(false)
    // Hard max: starter caps at 10 org datasets no matter how many addons.
    const maxed = { plan: 'starter', seatAddons: { datasets: 99 } } as any
    expect(checkDatasetQuota(maxed, 0).limit).toBe(10)
    expect(checkDatasetQuota(maxed, 10).upgradeRequired).toBe(true)
    // Free plan sells no dataset addons.
    expect(checkDatasetQuota({ plan: 'free' } as any, 0).upgradeRequired).toBe(
      true,
    )
  })

  it('folds purchased host/register/event-calendar add-ons into resolution (AGL-524)', () => {
    // Extra sites raise hostLimit on top of plan defaults.
    const withHosts = { plan: 'starter', seatAddons: { hosts: 2 } } as any
    expect(resolveOrgEntitlements(withHosts).hostLimit).toBe(
      PLAN_ENTITLEMENTS.starter.hostLimit + 2,
    )
    expect(checkQuota(withHosts, 'hostLimit', 2).allowed).toBe(true)
    // POS registers stack on the plan's included registers.
    const withRegisters = { plan: 'pro', seatAddons: { posRegisters: 3 } } as any
    expect(resolveOrgEntitlements(withRegisters).posRegisters).toBe(1 + 3)
    // Event Calendar: quantity ≥ 1 switches the org-wide feature on.
    const withEvents = { plan: 'starter', seatAddons: { eventCalendar: 1 } } as any
    expect(checkEntitlement(withEvents, 'eventCalendar')).toBe(true)
    expect(checkEntitlement({ plan: 'starter' } as any, 'eventCalendar')).toBe(
      false,
    )
    // Add-on purchases stack on top of staff entitlement overrides.
    const stacked = {
      plan: 'starter',
      entitlements: { hostLimit: 5 },
      seatAddons: { hosts: 1 },
    } as any
    expect(resolveOrgEntitlements(stacked).hostLimit).toBe(6)
  })

  it('stops counting purchased add-ons on dead subscriptions (AGL-524)', () => {
    const dead = {
      plan: 'pro',
      subscription: { status: 'canceled' },
      seatAddons: { hosts: 3, posRegisters: 2, eventCalendar: 1, managers: 2 },
    } as any
    // Add-ons bill on the subscription — a dead one takes them with it.
    expect(resolveOrgEntitlements(dead).hostLimit).toBe(
      PLAN_ENTITLEMENTS.free.hostLimit,
    )
    expect(resolveOrgEntitlements(dead).posRegisters).toBe(0)
    expect(checkEntitlement(dead, 'eventCalendar')).toBe(false)
    expect(checkSeatQuota(dead, 'managers', 0).purchased).toBe(0)
    // Dunning grace: past_due keeps them, matching resolveEffectivePlan.
    const pastDue = { ...dead, subscription: { status: 'past_due' } }
    expect(resolveOrgEntitlements(pastDue).hostLimit).toBe(
      PLAN_ENTITLEMENTS.pro.hostLimit + 3,
    )
    expect(checkSeatQuota(pastDue, 'managers', 0).purchased).toBe(2)
    // No subscription state at all keeps staff-set quantities (comped).
    const comped = { plan: 'pro', seatAddons: { hosts: 1 } } as any
    expect(resolveOrgEntitlements(comped).hostLimit).toBe(
      PLAN_ENTITLEMENTS.pro.hostLimit + 1,
    )
  })

  it('resolves legacy per-host dataset overrides into org keys (AGL-240)', () => {
    const legacy = {
      plan: 'starter',
      entitlements: { datasetsPerHost: 7, maxDatasetsPerHost: 12 },
    } as any
    const resolved = resolveOrgEntitlements(legacy)
    expect(resolved.datasetsPerOrg).toBe(7)
    expect(resolved.maxDatasetsPerOrg).toBe(12)
    // Org-keyed overrides win over legacy keys.
    const both = {
      plan: 'starter',
      entitlements: { datasetsPerHost: 7, datasetsPerOrg: 9 },
    } as any
    expect(resolveOrgEntitlements(both).datasetsPerOrg).toBe(9)
  })

  it('resolves the effective plan from subscription state (AGL-247)', () => {
    expect(resolveEffectivePlan(null)).toBe('free')
    expect(resolveEffectivePlan({} as any)).toBe('free')
    expect(resolveEffectivePlan({ plan: 'nonsense' } as any)).toBe('free')
    expect(resolveEffectivePlan({ plan: 'pro' } as any)).toBe('pro')
    // Dunning grace: past_due keeps the plan.
    expect(
      resolveEffectivePlan({
        plan: 'pro',
        subscription: { status: 'past_due' },
      } as any),
    ).toBe('pro')
    // Dead subscriptions downgrade paid plans to free.
    for (const status of ['canceled', 'unpaid', 'incomplete']) {
      expect(
        resolveEffectivePlan({ plan: 'business', subscription: { status } } as any),
      ).toBe('free')
    }
    // Entitlements follow: a canceled business org loses paid features.
    const canceled = {
      plan: 'business',
      subscription: { status: 'canceled' },
    } as any
    expect(checkEntitlement(canceled, 'workflows')).toBe(false)
    expect(checkQuota(canceled, 'screensPerHost', 5).allowed).toBe(false)
  })

  it('verifies plan × feature gating both directions (AGL-247)', () => {
    // Free must NOT reach paid features; paid tiers MUST reach theirs.
    const table: Array<[OrgPlan, keyof typeof PLAN_ENTITLEMENTS.free.features, boolean]> = [
      ['free', 'workflows', false],
      ['free', 'dataStore', false],
      ['free', 'marketingOverlays', false],
      ['free', 'customDomain', false],
      ['starter', 'workflows', true],
      ['starter', 'dataStore', true],
      ['starter', 'marketingOverlays', true],
      ['starter', 'versioning', false],
      ['pro', 'versioning', true],
      ['pro', 'aiAssist', true],
      ['pro', 'webhooks', false],
      ['business', 'webhooks', true],
      ['business', 'multilingual', true],
    ]
    for (const [plan, feature, expected] of table) {
      expect(checkEntitlement({ plan } as any, feature)).toBe(expected)
    }
  })

  it('denies a plan-less org (the created-org default) every gated path', () => {
    // `createOrganization` writes an org doc with NO `plan` field. Several
    // routes used to gate as `if (org.plan && !checkEntitlement(...))`, which
    // skipped the gate entirely for these plan-less orgs. The invariant those
    // routes now rely on: a plan-less org resolves as `free` and is denied.
    // Regression guard for the five leaked paths (siteExport, videoMedia,
    // mediaCdn, marketplaceSelling, storage quota).
    const created = { name: 'Acme', slug: 'acme', ownerUid: 'u1', hosts: {} } as any

    // Sanity: this is the plan-less shape, resolving as free.
    expect(created.plan).toBeUndefined()
    expect(resolveEffectivePlan(created)).toBe('free')

    // hosts/export + hosts/import
    expect(checkEntitlement(created, 'siteExport')).toBe(false)
    // media/upload + media/upload-url
    expect(checkEntitlement(created, 'videoMedia')).toBe(false)
    // media/upload + media/replace
    expect(checkEntitlement(created, 'mediaCdn')).toBe(false)
    // community publish / publish-plugin / publish-template
    expect(checkEntitlement(created, 'marketplaceSelling')).toBe(false)

    // Quotas: the free caps apply — a plan-less org is NOT unmetered.
    // media/upload storage (250 MB)
    const atCap = checkQuota(created, 'storagePerHostMb', 250)
    expect(atCap.limit).toBe(250)
    expect(atCap.allowed).toBe(false)
    expect(checkQuota(created, 'storagePerHostMb', 0).allowed).toBe(true)
    // hosts/create (hostLimit 1) — a plan-less org already has 1 host.
    expect(checkQuota(created, 'hostLimit', 1).allowed).toBe(false)
    // pages created from a template (screensPerHost 5). Installing a
    // marketplace template no longer creates screens — it fills the
    // template library, capped separately (AGL-669).
    expect(checkQuota(created, 'screensPerHost', 5).allowed).toBe(false)
    expect(checkQuota(created, 'templatesPerHost', 10).allowed).toBe(false)
    // hosts/members seat quota (free members cap is 1, no addons)
    const seats = checkSeatQuota(created, 'members', 1)
    expect(seats.allowed).toBe(false)
    expect(seats.upgradeRequired).toBe(true)

    // A per-org override still grants access (the intended escape hatch for
    // internal/staff workspaces — not the absent-plan hole).
    const override = { ...created, entitlements: { features: { siteExport: true } } }
    expect(checkEntitlement(override, 'siteExport')).toBe(true)
  })

  it('checkDataStorageQuota meters overage on paid plans, blocks on free (AGL-240)', () => {
    // Starter includes 1 GB; 1.5 GB used → 0.5 GB overage at $0.25/GB.
    const starter = checkDataStorageQuota({ plan: 'starter' } as any, 1536)
    expect(starter.allowed).toBe(true)
    expect(starter.includedMb).toBe(1024)
    expect(starter.overageGb).toBeCloseTo(0.5)
    expect(starter.overageMonthlyUsd).toBeCloseTo(0.13)
    // Within the included size there is no overage.
    const within = checkDataStorageQuota({ plan: 'pro' } as any, 1024)
    expect(within.overageGb).toBe(0)
    expect(within.remainingMb).toBe(4096)
    // Free has no metered rate and hard-blocks at the (zero) included size.
    const free = checkDataStorageQuota({ plan: 'free' } as any, 1)
    expect(free.allowed).toBe(false)
    expect(free.overageRateUsd).toBeNull()
  })

  it('checkApiRequestQuota meters overage on Business/Advanced, blocks below (AGL-634)', () => {
    // Business includes 100k requests; 150k used → 50k over at $0.50/1k = $25.
    const business = checkApiRequestQuota({ plan: 'business' } as any, 150_000)
    expect(business.allowed).toBe(true)
    expect(business.included).toBe(100_000)
    expect(business.overageRequests).toBe(50_000)
    expect(business.overageMonthlyUsd).toBeCloseTo(25)
    expect(business.overageRateUsd).toBe(0.5)
    // Advanced: 1M included, cheaper overage ($0.20/1k). 1.1M → 100k over = $20.
    const advanced = checkApiRequestQuota({ plan: 'advanced' } as any, 1_100_000)
    expect(advanced.included).toBe(1_000_000)
    expect(advanced.overageMonthlyUsd).toBeCloseTo(20)
    // Within the included quota there is no overage; remaining is tracked.
    const within = checkApiRequestQuota({ plan: 'business' } as any, 40_000)
    expect(within.overageRequests).toBe(0)
    expect(within.remaining).toBe(60_000)
    // Plans without API access have zero included and always block.
    const pro = checkApiRequestQuota({ plan: 'pro' } as any, 1)
    expect(pro.allowed).toBe(false)
    expect(pro.included).toBe(0)
    expect(pro.overageRateUsd).toBeNull()
  })

  it('checkContactQuota meters audience overage on paid plans, hard-bands free (AGL-890)', () => {
    // Starter includes 1,000 contacts; 3,500 used → 2,500 over at $1/1k.
    const starter = checkContactQuota({ plan: 'starter' } as any, 3_500)
    expect(starter.allowed).toBe(true)
    expect(starter.included).toBe(1_000)
    expect(starter.overageContacts).toBe(2_500)
    expect(starter.overageMonthlyUsd).toBeCloseTo(2.5)
    expect(starter.overageRateUsd).toBe(1)
    // Pro: 10k included at $0.75/1k over. 12k → 2k over = $1.50.
    const pro = checkContactQuota({ plan: 'pro' } as any, 12_000)
    expect(pro.allowed).toBe(true)
    expect(pro.overageMonthlyUsd).toBeCloseTo(1.5)
    // Within the band there is no overage; remaining is tracked.
    const within = checkContactQuota({ plan: 'business' } as any, 40_000)
    expect(within.overageContacts).toBe(0)
    expect(within.remaining).toBe(60_000)
    expect(within.allowed).toBe(true)
    // Free hard-bands at 100 — no rate, blocked at the band.
    const freeOver = checkContactQuota({ plan: 'free' } as any, 100)
    expect(freeOver.allowed).toBe(false)
    expect(freeOver.overageRateUsd).toBeNull()
    expect(freeOver.overageMonthlyUsd).toBe(0)
    const freeUnder = checkContactQuota({ plan: 'free' } as any, 40)
    expect(freeUnder.allowed).toBe(true)
    // A dead subscription downgrades to free's hard band (AGL-247).
    const dead = checkContactQuota(
      { plan: 'pro', subscription: { status: 'canceled' } } as any,
      150,
    )
    expect(dead.allowed).toBe(false)
    expect(dead.included).toBe(100)
  })

  it('gates commerce features per the AGL-278 matrix', () => {
    const table: Array<[OrgPlan, any, boolean]> = [
      ['free', 'commerce', false],
      ['starter', 'commerce', true],
      ['starter', 'pos', false],
      ['pro', 'pos', true],
      ['pro', 'abandonedCart', true],
      ['pro', 'giftCards', false],
      ['pro', 'storefrontSubscriptions', false],
      ['business', 'storefrontSubscriptions', true],
      ['business', 'contentGating', true],
      ['business', 'giftCards', true],
    ]
    for (const [plan, feature, expected] of table) {
      expect(checkEntitlement({ plan } as any, feature)).toBe(expected)
    }
  })

  it('caps products per host by plan (AGL-278)', () => {
    expect(checkQuota({ plan: 'free' } as any, 'productsPerHost', 0).allowed)
      .toBe(false)
    const starter = checkQuota(
      { plan: 'starter' } as any,
      'productsPerHost',
      99,
    )
    expect(starter.allowed).toBe(true)
    expect(starter.remaining).toBe(1)
    expect(
      checkQuota({ plan: 'starter' } as any, 'productsPerHost', 100).allowed,
    ).toBe(false)
  })

  it('resolves transaction fees by plan and product type (AGL-278)', () => {
    expect(resolveTransactionFeePct({ plan: 'starter' } as any, 'physical'))
      .toBe(2)
    expect(resolveTransactionFeePct({ plan: 'starter' } as any, 'digital'))
      .toBe(5)
    expect(resolveTransactionFeePct({ plan: 'pro' } as any, 'physical'))
      .toBe(0)
    expect(resolveTransactionFeePct({ plan: 'pro' } as any, 'service'))
      .toBe(3)
    expect(resolveTransactionFeePct({ plan: 'business' } as any, 'digital'))
      .toBe(2)
    // Pricing v3 (2026-07) digital fee ladder: 5 → 3 → 2 → 1 → 0 → 0.
    expect(resolveTransactionFeePct({ plan: 'scale' } as any, 'digital'))
      .toBe(1)
    expect(resolveTransactionFeePct({ plan: 'advanced' } as any, 'digital'))
      .toBe(0)
    expect(resolveTransactionFeePct({ plan: 'agency' } as any, 'digital'))
      .toBe(0)
    // Canceled subscriptions resolve to free — which cannot sell at all.
    expect(
      resolveTransactionFeePct(
        {
          plan: 'business',
          subscription: { status: 'canceled' },
        } as any,
        'digital',
      ),
    ).toBe(0)
  })

  describe('MRR (AGL-925)', () => {
    it('excludes a staff plan override, which writes no subscription', () => {
      const comped = { plan: 'business' } as any
      // The org still GETS business — only the revenue is zero.
      expect(resolveEffectivePlan(comped)).toBe('business')
      expect(isBillingSubscription(comped)).toBe(false)
      expect(orgMonthlyRevenueUsd(comped)).toBe(0)
    })

    it('excludes free, canceled, unpaid, and incomplete subscriptions', () => {
      expect(orgMonthlyRevenueUsd({ plan: 'free' } as any)).toBe(0)
      for (const status of ['canceled', 'unpaid', 'incomplete']) {
        expect(
          orgMonthlyRevenueUsd({ plan: 'pro', subscription: { status } } as any),
        ).toBe(0)
      }
    })

    it('counts active, trialing, and past_due as revenue', () => {
      for (const status of ['active', 'trialing', 'past_due']) {
        expect(
          orgMonthlyRevenueUsd({ plan: 'pro', subscription: { status } } as any),
        ).toBe(56)
      }
    })

    it('counts an annual plan at its per-month equivalent', () => {
      expect(
        orgMonthlyRevenueUsd({
          plan: 'business',
          subscription: { status: 'active', interval: 'year' },
        } as any),
      ).toBe(99)
      expect(
        orgMonthlyRevenueUsd({
          plan: 'business',
          subscription: { status: 'active', interval: 'month' },
        } as any),
      ).toBe(139)
    })

    it('adds purchased seat and dataset add-ons to the base price', () => {
      expect(
        orgMonthlyRevenueUsd({
          plan: 'starter',
          subscription: { status: 'active' },
          seatAddons: { managers: 2, members: 3, datasets: 1 },
        } as any),
      ).toBe(25 + 2 * 5 + 3 * 3 + 1 * 2)
    })

    it('counts host, POS-register, and Event-Calendar add-ons (v3 leak fix)', () => {
      // Previously omitted — understated MRR for every org carrying them.
      expect(
        orgMonthlyRevenueUsd({
          plan: 'business',
          subscription: { status: 'active' },
          seatAddons: { hosts: 2, posRegisters: 1, eventCalendar: 1 },
        } as any),
      ).toBe(139 + 2 * 5 + 89 + 9)
    })
  })

  describe('net revenue / processor fee (AGL-1108)', () => {
    it('subtracts Stripe 2.9% + 30¢ from a monthly-billed org', () => {
      expect(
        orgNetMonthlyRevenueUsd({
          plan: 'pro',
          subscription: { status: 'active', interval: 'month' },
        } as any),
      ).toBeCloseTo(56 * (1 - 0.029) - 0.3, 2)
    })

    it('amortizes the fixed 30¢ over 12 months for annual billing', () => {
      expect(
        orgNetMonthlyRevenueUsd({
          plan: 'business',
          subscription: { status: 'active', interval: 'year' },
        } as any),
      ).toBeCloseTo(99 * (1 - 0.029) - 0.3 / 12, 2)
    })

    it('is 0 for a non-billing org', () => {
      expect(orgNetMonthlyRevenueUsd({ plan: 'free' } as any)).toBe(0)
      expect(
        orgNetMonthlyRevenueUsd({
          plan: 'pro',
          subscription: { status: 'canceled' },
        } as any),
      ).toBe(0)
    })

    it('netOfProcessorFee never returns below 0', () => {
      expect(netOfProcessorFee(0.1)).toBe(0)
      expect(netOfProcessorFee(-5)).toBe(0)
    })
  })

  describe('per-org discount / net-of-discount MRR (AGL-1105)', () => {
    const proMonthly = {
      plan: 'pro',
      subscription: { status: 'active', interval: 'month' },
    } as any

    it('orgListPriceMonthlyUsd stays the pre-discount sticker', () => {
      expect(orgListPriceMonthlyUsd(proMonthly)).toBe(56)
      expect(
        orgListPriceMonthlyUsd({ ...proMonthly, discount: { percentOff: 25 } }),
      ).toBe(56)
    })

    it('applyDiscountUsd handles percent, fixed, clamps and floors', () => {
      expect(applyDiscountUsd(100, { percentOff: 20 })).toBe(80)
      expect(applyDiscountUsd(100, { amountOffUsd: 15 })).toBe(85)
      // A fixed amount larger than the bill never goes negative.
      expect(applyDiscountUsd(10, { amountOffUsd: 25 })).toBe(0)
      // Percent clamps to 0–100.
      expect(applyDiscountUsd(100, { percentOff: 150 })).toBe(0)
      expect(applyDiscountUsd(100, null)).toBe(100)
    })

    it('orgMonthlyRevenueUsd subtracts an applied percent discount', () => {
      expect(
        orgMonthlyRevenueUsd({
          ...proMonthly,
          discount: { couponId: 'co_1', percentOff: 20, appliedBy: 'u' },
        }),
      ).toBe(44.8)
    })

    it('orgMonthlyRevenueUsd subtracts an applied fixed discount', () => {
      expect(
        orgMonthlyRevenueUsd({
          plan: 'business',
          subscription: { status: 'active', interval: 'month' },
          discount: { couponId: 'co_2', amountOffUsd: 10, appliedBy: 'u' },
        } as any),
      ).toBe(129)
    })

    it('an undiscounted org still reads its full list price', () => {
      expect(orgMonthlyRevenueUsd(proMonthly)).toBe(56)
      expect(orgMonthlyRevenueUsd(proMonthly)).toBe(
        orgListPriceMonthlyUsd(proMonthly),
      )
    })

    it('a discount on a non-billing org changes nothing (0)', () => {
      expect(
        orgMonthlyRevenueUsd({
          plan: 'free',
          discount: { couponId: 'co_3', percentOff: 50, appliedBy: 'u' },
        } as any),
      ).toBe(0)
    })

    it('net revenue is net of BOTH the discount and the processor fee', () => {
      const org = {
        ...proMonthly,
        discount: { couponId: 'co_4', percentOff: 20, appliedBy: 'u' },
      }
      // 56 → 44.80 after the discount, then less Stripe 2.9% + 30¢.
      expect(orgNetMonthlyRevenueUsd(org)).toBeCloseTo(
        netOfProcessorFee(44.8, false),
        2,
      )
    })
  })

  describe('discount margin guardrail (AGL-1105)', () => {
    const businessMonthly = {
      plan: 'business',
      subscription: { status: 'active', interval: 'month' },
    } as any

    it('rates a modest discount ok and reports the list price as gross', () => {
      const result = checkDiscountMargin(businessMonthly, { percentOff: 10 })
      expect(result.grossUsd).toBe(139)
      expect(result.discountedUsd).toBe(applyDiscountUsd(139, { percentOff: 10 }))
      expect(result.netUsd).toBe(netOfProcessorFee(125.1, false))
      expect(result.floorPct).toBe(NET_MARGIN_FLOOR_PCT)
      expect(result.marginPct).toBeGreaterThanOrEqual(NET_MARGIN_FLOOR_PCT)
      expect(result.rating).toBe('ok')
    })

    it('warns when the margin dips into the band below the floor', () => {
      // 94% off a $139 sub nets ~$7.80 against ~$2 infra → ~74% margin.
      const result = checkDiscountMargin(businessMonthly, { percentOff: 94 })
      expect(result.rating).toBe('warn')
      expect(result.marginPct).toBeLessThan(NET_MARGIN_FLOOR_PCT)
      expect(result.marginPct).toBeGreaterThanOrEqual(
        NET_MARGIN_FLOOR_PCT - 0.1,
      )
    })

    it('blocks a discount that pushes the margin well below the floor', () => {
      const result = checkDiscountMargin(businessMonthly, { percentOff: 97 })
      expect(result.rating).toBe('block')
      expect(result.marginPct).toBeLessThan(NET_MARGIN_FLOOR_PCT - 0.1)
    })

    it('blocks a 100%-off discount (net ≤ 0) with a clamped margin', () => {
      const result = checkDiscountMargin(businessMonthly, { percentOff: 100 })
      expect(result.discountedUsd).toBe(0)
      expect(result.netUsd).toBe(0)
      expect(result.marginPct).toBe(-1)
      expect(result.rating).toBe('block')
    })

    it('scales infra COGS by the number of sites the org runs', () => {
      const oneSite = checkDiscountMargin(businessMonthly, { percentOff: 10 })
      expect(oneSite.infraCogsUsd).toBe(INFRA_COGS_PER_SITE_USD)
      const manySites = checkDiscountMargin(
        { ...businessMonthly, hosts: { a: true, b: true, c: true } },
        { percentOff: 10 },
      )
      expect(manySites.infraCogsUsd).toBe(INFRA_COGS_PER_SITE_USD * 3)
      // More infra against the same revenue can only lower the margin.
      expect(manySites.marginPct).toBeLessThan(oneSite.marginPct)
    })

    it('rates a non-billing org ok — no revenue to protect', () => {
      const result = checkDiscountMargin({ plan: 'free' } as any, {
        percentOff: 50,
      })
      expect(result.grossUsd).toBe(0)
      expect(result.rating).toBe('ok')
    })

    it('does not double-count a discount already on the org', () => {
      // grossUsd is always the list price, regardless of org.discount.
      const withExisting = checkDiscountMargin(
        { ...businessMonthly, discount: { couponId: 'co', percentOff: 50 } },
        { percentOff: 10 },
      )
      expect(withExisting.grossUsd).toBe(139)
    })
  })

  describe('white-label (White-Label Phase 1)', () => {
    it('gates the whiteLabel entitlement to Agency (and per-org overrides)', () => {
      expect(checkEntitlement({ plan: 'agency' } as any, 'whiteLabel')).toBe(true)
      // Every non-agency tier — including Advanced — is off by default.
      for (const plan of ['free', 'starter', 'pro', 'business', 'scale', 'advanced'] as OrgPlan[]) {
        expect(checkEntitlement({ plan } as any, 'whiteLabel')).toBe(false)
      }
      // Enterprise inherits via the per-org entitlements override mechanism.
      const enterprise = {
        plan: 'business',
        entitlements: { features: { whiteLabel: true } },
      } as any
      expect(checkEntitlement(enterprise, 'whiteLabel')).toBe(true)
      // A canceled agency subscription downgrades to free — and loses it.
      const canceled = {
        plan: 'agency',
        subscription: { status: 'canceled' },
      } as any
      expect(checkEntitlement(canceled, 'whiteLabel')).toBe(false)
    })

    it('returns the Aglyn defaults when white-label is off, ignoring any stored profile', () => {
      expect(resolveBrandingProfile(undefined)).toEqual(AGLYN_BRANDING_PROFILE)
      expect(resolveBrandingProfile({ plan: 'business' } as any).productName).toBe(
        'Aglyn',
      )
      // A profile stored without the entitlement is ignored entirely.
      const notEntitled = {
        plan: 'pro',
        brandingProfile: { productName: 'Acme Sites', fromName: 'Acme' },
      } as any
      expect(resolveBrandingProfile(notEntitled)).toEqual(AGLYN_BRANDING_PROFILE)
    })

    it('applies the org profile when white-label is on, filling gaps with Aglyn defaults', () => {
      const org = {
        plan: 'agency',
        brandingProfile: {
          productName: 'Acme Sites',
          fromName: 'Acme Team',
          logoUrl: 'https://cdn.acme.com/logo.png',
          primaryColor: '#ff5a00',
          // supportUrl / faviconUrl / emailLogoUrl / customConsoleDomain omitted
        },
      } as any
      const brand = resolveBrandingProfile(org)
      expect(brand.productName).toBe('Acme Sites')
      expect(brand.fromName).toBe('Acme Team')
      expect(brand.logoUrl).toBe('https://cdn.acme.com/logo.png')
      expect(brand.primaryColor).toBe('#ff5a00')
      // Unset fields fall back to the Aglyn defaults, not undefined.
      expect(brand.supportUrl).toBe(AGLYN_BRANDING_PROFILE.supportUrl)
      expect(brand.faviconUrl).toBeNull()
      expect(brand.customConsoleDomain).toBeNull()
    })

    it('is on by default for the Agency tier with no explicit override', () => {
      const brand = resolveBrandingProfile({
        plan: 'agency',
        brandingProfile: { productName: 'Studio One' },
      } as any)
      expect(brand.productName).toBe('Studio One')
    })

    it('treats blank/whitespace profile fields as unset (Aglyn default wins)', () => {
      const org = {
        plan: 'agency',
        brandingProfile: { productName: '   ', fromName: '' },
      } as any
      const brand = resolveBrandingProfile(org)
      expect(brand.productName).toBe('Aglyn')
      expect(brand.fromName).toBe('Aglyn')
    })
  })

  it('prices the AGL-278 table (annual headline, monthly billing)', () => {
    expect(PLAN_PRICING.starter.basePriceAnnualMonthlyUsd).toBe(16)
    expect(PLAN_PRICING.starter.basePriceMonthlyUsd).toBe(25)
    expect(PLAN_PRICING.pro.basePriceAnnualMonthlyUsd).toBe(39)
    expect(PLAN_PRICING.pro.basePriceMonthlyUsd).toBe(56)
    expect(PLAN_PRICING.business.basePriceAnnualMonthlyUsd).toBe(99)
    expect(PLAN_PRICING.business.basePriceMonthlyUsd).toBe(139)
  })
})
