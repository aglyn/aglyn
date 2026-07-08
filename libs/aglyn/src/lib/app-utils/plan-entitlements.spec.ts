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
  checkDatasetQuota,
  checkEntitlement,
  checkQuota,
  checkSeatQuota,
  PLAN_ENTITLEMENTS,
  PLAN_PRICING,
  resolveTenantEntitlements,
  UNLIMITED,
} from './plan-entitlements'

describe('plan entitlements', () => {
  it('resolves missing/unknown plans as free', () => {
    expect(resolveTenantEntitlements(undefined).hostLimit).toBe(1)
    expect(resolveTenantEntitlements({ plan: 'nope' as any }).hostLimit).toBe(1)
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

  it('applies per-tenant overrides key-by-key', () => {
    const tenant = {
      plan: 'free',
      entitlements: { hostLimit: 10, features: { versioning: true } },
    } as any
    const resolved = resolveTenantEntitlements(tenant)
    expect(resolved.hostLimit).toBe(10)
    expect(resolved.features.versioning).toBe(true)
    // untouched defaults survive
    expect(resolved.screensPerHost).toBe(5)
    expect(resolved.features.customDomain).toBe(false)
  })

  it('checkQuota gates at the limit and never reports negative remaining', () => {
    const tenant = { plan: 'free' } as any
    expect(checkQuota(tenant, 'hostLimit', 0)).toEqual({
      allowed: true,
      limit: 1,
      remaining: 1,
    })
    expect(checkQuota(tenant, 'hostLimit', 1).allowed).toBe(false)
    expect(checkQuota(tenant, 'hostLimit', 5).remaining).toBe(0)
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
    expect(PLAN_ENTITLEMENTS.free.datasetsPerHost).toBe(0)
    expect(PLAN_ENTITLEMENTS.free.features.workflows).toBe(false)
    expect(PLAN_ENTITLEMENTS.starter.variablesPerHost).toBe(25)
    expect(PLAN_ENTITLEMENTS.starter.features.dataStore).toBe(true)
    expect(PLAN_ENTITLEMENTS.pro.functionsPerHost).toBe(50)
    expect(PLAN_ENTITLEMENTS.business.recordsPerDataset).toBe(100000)
  })

  it('treats UNLIMITED quotas as always allowed', () => {
    const tenant = { plan: 'business' } as any
    const result = checkQuota(tenant, 'screensPerHost', 100000)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(UNLIMITED)
  })

  it('pins the AGL-68 pricing model', () => {
    expect(PLAN_PRICING).toEqual({
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
    })
  })

  it('pins the AGL-112 seat table', () => {
    expect(
      Object.fromEntries(
        Object.entries(PLAN_ENTITLEMENTS).map(([plan, value]) => [
          plan,
          [
            value.managersPerTenant,
            value.maxManagersPerTenant,
            value.membersPerHost,
            value.maxMembersPerHost,
          ],
        ]),
      ),
    ).toEqual({
      free: [1, 1, 1, 1],
      starter: [2, 5, 3, 10],
      pro: [5, 20, 10, 25],
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

  it('checkDatasetQuota counts purchased addon datasets up to the max (AGL-132)', () => {
    const tenant = { plan: 'starter', seatAddons: { datasets: 2 } } as any
    const quota = checkDatasetQuota(tenant, 2)
    expect(quota.limit).toBe(3)
    expect(quota.allowed).toBe(true)
    expect(checkDatasetQuota(tenant, 3).allowed).toBe(false)
    // Hard max: starter caps at 3 no matter how many addons.
    const maxed = { plan: 'starter', seatAddons: { datasets: 99 } } as any
    expect(checkDatasetQuota(maxed, 0).limit).toBe(3)
    expect(checkDatasetQuota(maxed, 3).upgradeRequired).toBe(true)
    // Free plan sells no dataset addons.
    expect(checkDatasetQuota({ plan: 'free' } as any, 0).upgradeRequired).toBe(
      true,
    )
  })
})
