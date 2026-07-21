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
  checkApiRequestQuota,
  checkDataStorageQuota,
  checkDatasetQuota,
  checkEntitlement,
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
      advanced: [25, UNLIMITED, UNLIMITED],
    })
    // Media storage exceeds the published-site cap by design (AGL-67).
    for (const plan of Object.values(PLAN_ENTITLEMENTS)) {
      expect(plan.storagePerHostMb).toBeGreaterThan(plan.totalSiteSizeMb)
    }
    expect(PLAN_ENTITLEMENTS.starter.features.removeBranding).toBe(true)
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
        extraMemberMonthlyUsd: null,
        extraDatasetMonthlyUsd: null,
        extraDataGbMonthlyUsd: null,
        extraApiRequestsUsdPer1k: null,
      },
      starter: {
        basePriceMonthlyUsd: 25,
        basePriceAnnualMonthlyUsd: 16,
        extraHostMonthlyUsd: 10,
        extraSeatMonthlyUsd: 5,
        extraMemberMonthlyUsd: 3,
        extraDatasetMonthlyUsd: 2,
        extraDataGbMonthlyUsd: 0.25,
        extraApiRequestsUsdPer1k: null,
      },
      pro: {
        basePriceMonthlyUsd: 56,
        basePriceAnnualMonthlyUsd: 39,
        extraHostMonthlyUsd: 8,
        extraSeatMonthlyUsd: 4,
        extraMemberMonthlyUsd: 2,
        extraDatasetMonthlyUsd: 2,
        extraDataGbMonthlyUsd: 0.25,
        extraApiRequestsUsdPer1k: null,
      },
      business: {
        basePriceMonthlyUsd: 139,
        basePriceAnnualMonthlyUsd: 99,
        extraHostMonthlyUsd: 5,
        extraSeatMonthlyUsd: 3,
        extraMemberMonthlyUsd: 1,
        extraDatasetMonthlyUsd: 1,
        extraDataGbMonthlyUsd: 0.25,
        extraApiRequestsUsdPer1k: 0.5,
      },
      advanced: {
        basePriceMonthlyUsd: 399,
        basePriceAnnualMonthlyUsd: 299,
        extraHostMonthlyUsd: 4,
        extraSeatMonthlyUsd: 2,
        extraMemberMonthlyUsd: 1,
        extraDatasetMonthlyUsd: 1,
        extraDataGbMonthlyUsd: 0.25,
        extraApiRequestsUsdPer1k: 0.2,
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
    // community/install-template (screensPerHost 5)
    expect(checkQuota(created, 'screensPerHost', 5).allowed).toBe(false)
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
      .toBe(7)
    expect(resolveTransactionFeePct({ plan: 'pro' } as any, 'physical'))
      .toBe(0)
    expect(resolveTransactionFeePct({ plan: 'pro' } as any, 'service'))
      .toBe(5)
    expect(resolveTransactionFeePct({ plan: 'business' } as any, 'digital'))
      .toBe(2)
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

  it('prices the AGL-278 table (annual headline, monthly billing)', () => {
    expect(PLAN_PRICING.starter.basePriceAnnualMonthlyUsd).toBe(16)
    expect(PLAN_PRICING.starter.basePriceMonthlyUsd).toBe(25)
    expect(PLAN_PRICING.pro.basePriceAnnualMonthlyUsd).toBe(39)
    expect(PLAN_PRICING.pro.basePriceMonthlyUsd).toBe(56)
    expect(PLAN_PRICING.business.basePriceAnnualMonthlyUsd).toBe(99)
    expect(PLAN_PRICING.business.basePriceMonthlyUsd).toBe(139)
  })
})
