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
  PLAN_ENTITLEMENTS,
  PLAN_LABELS,
  PRICE_ENTITLEMENT_KEYS,
  resolveOrgEntitlements,
} from '../app-utils/plan-entitlements'
import type { OrgPlan } from '../foundation'
import {
  planQuotaOf,
  pluginPlanEntitlementOwner,
  pluginPlanFeatures,
  pluginPlanQuotas,
} from './plugin-plan-entitlements'

const PLANS = Object.keys(PLAN_LABELS).sort() as OrgPlan[]

describe('a plugin declares what each plan includes of its own keys (AGL-3080)', () => {
  it('every declaration names every plan, and no other', () => {
    for (const declared of [...pluginPlanQuotas(), ...pluginPlanFeatures()]) {
      expect([declared.key, Object.keys(declared.byPlan).sort()]).toEqual([declared.key, PLANS])
    }
  })

  /*
   * The composed table carries each declared figure on every plan. A key
   * core's own rows already carried would keep CORE's figure and fail here
   * the moment the two differ — the collision the composition refuses to let
   * shadow a charged value.
   */
  it('the plan table carries every declared quota, at the declared figure', () => {
    for (const declared of pluginPlanQuotas()) {
      for (const plan of PLANS) {
        const row = PLAN_ENTITLEMENTS[plan] as unknown as Record<string, unknown>
        expect([declared.key, plan, row[declared.key]]).toEqual([
          declared.key,
          plan,
          declared.byPlan[plan],
        ])
      }
    }
  })

  it('the plan table carries every declared feature, at the declared answer', () => {
    for (const declared of pluginPlanFeatures()) {
      for (const plan of PLANS) {
        const features = PLAN_ENTITLEMENTS[plan].features as unknown as Record<string, unknown>
        expect([declared.key, plan, features[declared.key]]).toEqual([
          declared.key,
          plan,
          declared.byPlan[plan],
        ])
      }
    }
  })

  /*
   * The plugins that sell a band or gate one today. Named, so a declaration
   * that stopped compiling in — a dropped `register.planEntitlements`, a
   * renamed function — is red here by the key it lost rather than by a
   * pricing figure three suites away.
   */
  it('the first-party declarations are compiled in', () => {
    const owners = Object.fromEntries(
      [
        'assistCreditsPerMonth',
        'crmEmailsPerDay',
        'formSubmissionsPerMonth',
        'marketplaceFeePct',
        'workflowRunsPerMonth',
        'marketplaceSelling',
        'storefrontSubscriptions',
        'giftCards',
        'commerceAnalytics',
      ].map((key) => [key, pluginPlanEntitlementOwner(key)]),
    )
    expect(owners).toEqual({
      assistCreditsPerMonth: 'ai',
      crmEmailsPerDay: 'crm',
      formSubmissionsPerMonth: 'forms',
      marketplaceFeePct: 'marketplace',
      workflowRunsPerMonth: 'workflows',
      marketplaceSelling: 'marketplace',
      storefrontSubscriptions: 'commerce',
      giftCards: 'commerce',
      commerceAnalytics: 'commerce',
    })
  })

  it('a declared take rate is a PRICE, which an uncapped comp never lifts', () => {
    const prices = pluginPlanQuotas().filter((declared) => declared.price)
    expect(prices.length).toBeGreaterThan(0)
    for (const declared of prices) expect(PRICE_ENTITLEMENT_KEYS.has(declared.key)).toBe(true)
    for (const declared of pluginPlanQuotas().filter((one) => !one.price)) {
      expect(PRICE_ENTITLEMENT_KEYS.has(declared.key)).toBe(false)
    }
  })

  it('a declared key resolves and takes a per-org override like a core key', () => {
    const [declared] = pluginPlanQuotas()
    const resolved = resolveOrgEntitlements({
      plan: 'pro',
      entitlements: { [declared.key]: 7 },
    } as never)
    expect(planQuotaOf(resolved, declared.key)).toBe(7)
    expect(planQuotaOf(resolveOrgEntitlements({ plan: 'pro' } as never), declared.key)).toBe(
      declared.byPlan.pro,
    )
  })
})

describe('an undeclared key reads as nothing included', () => {
  it('is 0 — never unlimited, never free', () => {
    const resolved = resolveOrgEntitlements({ plan: 'agency' } as never)
    expect(planQuotaOf(resolved, 'aKeyNoPluginDeclares')).toBe(0)
    expect(planQuotaOf({ aKey: Number.NaN }, 'aKey')).toBe(0)
    expect(planQuotaOf({ aKey: '12' }, 'aKey')).toBe(0)
  })

  it('keeps UNLIMITED where a plan declares it', () => {
    expect(planQuotaOf({ aKey: Number.POSITIVE_INFINITY }, 'aKey')).toBe(Number.POSITIVE_INFINITY)
  })
})
