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

/**
 * A STAFF PLAN COMP (AGL-3034).
 *
 * A staff override set a canceled workspace to Pro, answered 200, and changed
 * nothing: `resolveEffectivePlan` reads a paid plan on a dead subscription as
 * Free (AGL-247), and nothing told staff. The fix could not be "let the stored
 * plan win", because a stored paid plan beside a canceled subscription is also
 * what a customer who LEFT looks like. So a comp is its own marker, and these
 * cases pin the four rules that make that safe:
 *
 *  1. a canceled customer with a stored paid plan stays Free;
 *  2. a comp applies on a dead (or absent) subscription;
 *  3. a live subscription beats a comp;
 *  4. clearing a comp returns the workspace to what it was without one.
 *
 * And the one that keeps it away from money: a comp sells nothing past any
 * band, so nothing it does can be priced onto an invoice.
 */

import {
  assistBandRefuses,
  assistMonthOverage,
  priceAssistCreditOverage,
  resolveAssistOverageRateUsdPer1k,
} from './assist-credits'
import {
  AI_ADDON_CREDITS_PER_MONTH,
  checkApiRequestQuota,
  checkCrmRecordsQuota,
  checkDataStorageQuota,
  checkDatasetQuota,
  checkEntitlement,
  checkSeatQuota,
  describeOrgPlan,
  hasAiAddon,
  isBillingSubscription,
  isEnterpriseOrg,
  orgListPriceMonthlyUsd,
  orgMonthlyRevenueUsd,
  orgPlanDescriptionSentence,
  orgSubscriptionState,
  PLAN_ENTITLEMENTS,
  PLAN_PRICING,
  planMetersInfraOverage,
  priceEmailSendOverage,
  readOrgPlanComp,
  resolveEffectivePlan,
  resolveOrgEntitlements,
  resolvePlanComp,
  resolvePlanPricing,
} from './plan-entitlements'
import type { OrgPlan } from '../foundation'

const DEAD = ['canceled', 'unpaid', 'incomplete', 'incomplete_expired']

/** A comp as the override route writes it. */
const comp = (plan: string, extra: Record<string, unknown> = {}) => ({
  plan,
  reason: 'beta',
  note: 'AGL-3024 live run',
  grantedBy: 'staff-1',
  grantedAt: { seconds: 1_789_560_000, nanoseconds: 0 },
  ...extra,
})

/** test-org's shape on 2026-09-16, before and after the comp. */
const TEST_ORG = {
  plan: 'pro',
  billingStatus: 'canceled',
  entitlements: {
    assistCreditsPerMonth: 5000,
    features: {
      storefrontSubscriptions: true,
      marketplaceSelling: true,
      whiteLabel: false,
      aiGenerative: true,
    },
  },
} as const
const withComp = (org: Record<string, any>, planComp: unknown) =>
  ({
    ...org,
    entitlements: { ...(org['entitlements'] ?? {}), planComp },
  }) as any

describe('a canceled customer with a stored paid plan stays Free (AGL-3034)', () => {
  it('reads every dead status as Free, through the mirror and the inline status', () => {
    for (const status of DEAD) {
      expect(resolveEffectivePlan({ plan: 'pro', billingStatus: status } as any)).toBe('free')
      expect(
        resolveEffectivePlan({ plan: 'business', subscription: { status } } as any),
      ).toBe('free')
    }
  })

  it('stays Free with staff quota and feature overrides but no comp — test-org as it was', () => {
    // The live case. Overrides still apply on top of Free, and nothing about
    // them is a comp: the stored `plan: 'pro'` must not be read as one.
    expect(resolveEffectivePlan(TEST_ORG as any)).toBe('free')
    expect(readOrgPlanComp(TEST_ORG as any)).toBeNull()
    expect(checkEntitlement(TEST_ORG as any, 'reusableComponents')).toBe(false)
    expect(resolveOrgEntitlements(TEST_ORG as any).assistCreditsPerMonth).toBe(5000)
    expect(describeOrgPlan(TEST_ORG as any)).toMatchObject({
      effectivePlan: 'free',
      storedPlan: 'pro',
      subscription: 'dead',
      subscriptionStatus: 'canceled',
      comp: null,
      compInForce: false,
      decidedBy: 'lapsed',
    })
  })
})

describe('a comp applies on a dead subscription (AGL-3034)', () => {
  it('resolves the comp plan for every dead status', () => {
    for (const status of DEAD) {
      const org = withComp({ plan: 'pro', billingStatus: status }, comp('business'))
      expect(resolveEffectivePlan(org)).toBe('business')
      expect(resolvePlanComp(org)?.plan).toBe('business')
    }
  })

  it('gives test-org Pro — components, the plan band, and its own 5,000 credits', () => {
    const org = withComp(TEST_ORG, comp('pro'))
    expect(resolveEffectivePlan(org)).toBe('pro')
    // "0/0 components on your plan" was this entitlement answering false.
    expect(checkEntitlement(org, 'reusableComponents')).toBe(true)
    const resolved = resolveOrgEntitlements(org)
    expect(resolved.hostLimit).toBe(PLAN_ENTITLEMENTS.pro.hostLimit)
    // The per-org override still wins over the comp plan's default.
    expect(resolved.assistCreditsPerMonth).toBe(5000)
    expect(resolved.features.aiGenerative).toBe(true)
    expect(resolved.features.whiteLabel).toBe(false)
    // The comp is not a quota, and never leaks into the resolved limits.
    expect('planComp' in resolved).toBe(false)
  })

  it('also applies where no subscription exists at all, over a plan stored directly', () => {
    const org = withComp({ plan: 'starter' }, comp('scale'))
    expect(orgSubscriptionState(org)).toBe('none')
    expect(resolveEffectivePlan(org)).toBe('scale')
    expect(describeOrgPlan(org).decidedBy).toBe('comp')
  })

  it('reads the comp in full, and a stamp in any of the shapes it arrives in', () => {
    const stamped = (grantedAt: unknown) =>
      readOrgPlanComp(withComp({}, comp('pro', { grantedAt })))?.grantedAt
    const iso = '2026-09-16T12:00:00.000Z'
    expect(readOrgPlanComp(withComp({}, comp('pro', { grantedAt: iso })))).toEqual({
      plan: 'pro',
      reason: 'beta',
      note: 'AGL-3024 live run',
      grantedBy: 'staff-1',
      grantedAt: iso,
    })
    expect(stamped({ toDate: () => new Date(iso) })).toBe(iso)
    expect(stamped({ _seconds: Date.parse(iso) / 1000 })).toBe(iso)
    expect(stamped(new Date(iso))).toBe(iso)
    // A stamp that does not read back does not cost the comp its plan.
    expect(readOrgPlanComp(withComp({}, comp('pro', { grantedAt: 'soon' })))?.plan).toBe(
      'pro',
    )
    expect(stamped('soon')).toBeNull()
  })

  it('does not count add-ons bought on the dead subscription', () => {
    // Add-ons bill as items on the subscription that died. A comp grants a
    // plan, not what the customer used to buy on top of one.
    const org = withComp(
      {
        plan: 'pro',
        billingStatus: 'canceled',
        seatAddons: { hosts: 4, aiAddon: 1, eventCalendar: 1 },
      },
      comp('pro'),
    )
    expect(hasAiAddon(org)).toBe(false)
    const resolved = resolveOrgEntitlements(org)
    expect(resolved.hostLimit).toBe(PLAN_ENTITLEMENTS.pro.hostLimit)
    expect(resolved.assistCreditsPerMonth).toBe(PLAN_ENTITLEMENTS.pro.assistCreditsPerMonth)
    expect(resolved.assistCreditsPerMonth).not.toBe(
      PLAN_ENTITLEMENTS.pro.assistCreditsPerMonth + AI_ADDON_CREDITS_PER_MONTH.pro,
    )
  })
})

describe('a live subscription beats a comp (AGL-3034)', () => {
  it.each(['active', 'trialing', 'past_due', 'paused'])(
    'the subscription decides on %s — a status the resolver does not read as dead',
    (status) => {
      const org = withComp({ plan: 'starter', billingStatus: status }, comp('agency'))
      expect(resolveEffectivePlan(org)).toBe('starter')
      expect(resolvePlanComp(org)).toBeNull()
      // Stored, and dormant — not gone.
      expect(readOrgPlanComp(org)?.plan).toBe('agency')
      expect(describeOrgPlan(org)).toMatchObject({
        decidedBy: 'subscription',
        compInForce: false,
        comp: { plan: 'agency' },
      })
      expect(orgPlanDescriptionSentence(describeOrgPlan(org))).toMatch(/dormant/)
    },
  )

  it('takes over again when that subscription ends', () => {
    const live = withComp({ plan: 'business', billingStatus: 'active' }, comp('pro'))
    const ended = { ...live, plan: 'free', billingStatus: 'canceled' }
    expect(resolveEffectivePlan(live)).toBe('business')
    expect(resolveEffectivePlan(ended)).toBe('pro')
  })
})

describe('clearing a comp returns Free (AGL-3034)', () => {
  it('on a dead subscription', () => {
    const comped = withComp(TEST_ORG, comp('pro'))
    const entitlements = { ...comped.entitlements }
    delete entitlements.planComp
    const cleared = { ...comped, entitlements }
    expect(resolveEffectivePlan(comped)).toBe('pro')
    expect(resolveEffectivePlan(cleared)).toBe('free')
  })

  it('on a workspace that never subscribed and stores no paid plan', () => {
    const comped = withComp({ plan: 'free' }, comp('business'))
    expect(resolveEffectivePlan(comped)).toBe('business')
    expect(resolveEffectivePlan({ plan: 'free', entitlements: {} } as any)).toBe('free')
  })

  it('and to the plan stored directly where one predates comps — the control', () => {
    // Clearing removes the comp, not a plan staff set before comps existed:
    // that one decided the org's plan before and decides it again.
    const cleared = { plan: 'enterprise', entitlements: {} } as any
    expect(resolveEffectivePlan(cleared)).toBe('enterprise')
    expect(describeOrgPlan(cleared).decidedBy).toBe('stored-plan')
  })
})

describe('a malformed comp grants nothing (AGL-3034)', () => {
  it.each<[string, unknown]>([
    ['a comp of Free', comp('free')],
    ['an unknown plan', comp('unobtainium')],
    ['a prototype key', comp('constructor')],
    ['a non-string plan', comp(7 as never)],
    ['a string', 'pro'],
    ['an array', ['pro']],
    ['null', null],
  ])('%s', (_label, planComp) => {
    const org = withComp({ plan: 'pro', billingStatus: 'canceled' }, planComp)
    expect(readOrgPlanComp(org)).toBeNull()
    expect(resolveEffectivePlan(org)).toBe('free')
  })

  it('an unrecognised reason still grants the plan, with the reason read as none', () => {
    const org = withComp({ billingStatus: 'canceled' }, comp('pro', { reason: 'vibes' }))
    expect(readOrgPlanComp(org)).toMatchObject({ plan: 'pro', reason: null })
  })
})

describe('a comp sells nothing past its bands (AGL-3034)', () => {
  const PAID: OrgPlan[] = ['starter', 'pro', 'business', 'scale', 'advanced', 'agency']

  it('withholds every rate on every plan row, keeping only the list prices', () => {
    for (const plan of PAID) {
      const pricing = resolvePlanPricing(withComp({ billingStatus: 'canceled' }, comp(plan)))
      for (const [key, value] of Object.entries(PLAN_PRICING[plan])) {
        if (key.startsWith('basePrice')) {
          expect((pricing as any)[key]).toBe(value)
        } else if (typeof value === 'boolean') {
          expect(`${plan}.${key}: ${(pricing as any)[key]}`).toBe(`${plan}.${key}: false`)
        } else {
          expect(`${plan}.${key}: ${(pricing as any)[key]}`).toBe(`${plan}.${key}: null`)
        }
      }
    }
  })

  it('makes each metered band a wall rather than a line usage is sold past', () => {
    const org = withComp({ billingStatus: 'canceled' }, comp('business'))
    const band = resolveOrgEntitlements(org)
    expect(checkCrmRecordsQuota(org, band.contactsPerHost).allowed).toBe(false)
    expect(checkCrmRecordsQuota(org, band.contactsPerHost + 5000).overageMonthlyUsd).toBe(0)
    expect(checkApiRequestQuota(org, band.apiRequestsPerMonth).allowed).toBe(false)
    expect(checkDataStorageQuota(org, band.dataStorageMbPerOrg).allowed).toBe(false)
    expect(priceEmailSendOverage(org, 50_000).overageMonthlyUsd).toBe(0)
    expect(planMetersInfraOverage(org)).toBe(false)
    // A seat or a dataset cannot be bought without a subscription to add it to.
    expect(checkSeatQuota(org, 'managers', 0).upgradeRequired).toBe(true)
    expect(checkDatasetQuota(org, 0).addonPriceUsd).toBeNull()

    // The same plan on a live subscription sells past the band — the control
    // that proves the wall is the comp's, not the plan's.
    const paying = { plan: 'business', billingStatus: 'active' } as any
    expect(checkCrmRecordsQuota(paying, band.contactsPerHost).allowed).toBe(true)
    expect(planMetersInfraOverage(paying)).toBe(true)
  })

  it('prices no AI overage, so the assist band refuses at 100%', () => {
    const org = withComp(TEST_ORG, comp('pro'))
    expect(resolveAssistOverageRateUsdPer1k(org)).toBeNull()
    expect(assistBandRefuses(org)).toBe(true)
    // Ten times the band, measured: still nothing to bill.
    const month = assistMonthOverage(org, 50)
    expect(month.overageCredits).toBeGreaterThan(0)
    expect(month.overageMonthlyUsd).toBe(0)
    expect(month.overageRateUsd).toBeNull()
    expect(priceAssistCreditOverage(org, 1_000_000).overageMonthlyUsd).toBe(0)

    // The control: Pro on a live subscription does sell it.
    const paying = { plan: 'pro', billingStatus: 'active' } as any
    expect(resolveAssistOverageRateUsdPer1k(paying)).toBe(
      PLAN_PRICING.pro.extraAssistCreditsUsdPer1k,
    )
  })

  it('refuses the Starter add-on rate to a Starter comp with a staff-set add-on', () => {
    // No subscription, so a staff-set add-on quantity still counts (the AI
    // plugin widens the band from it when registered) — and without the comp
    // check that band would be sold past at the add-on rate, to nobody.
    const org = withComp({ seatAddons: { aiAddon: 1 } }, comp('starter'))
    expect(hasAiAddon(org)).toBe(true)
    expect(resolveAssistOverageRateUsdPer1k(org)).toBeNull()
    expect(assistBandRefuses(org)).toBe(true)
    // The control: the same add-on on a live Starter subscription is sold.
    const paying = { plan: 'starter', billingStatus: 'active', seatAddons: { aiAddon: 1 } }
    expect(resolveAssistOverageRateUsdPer1k(paying as any)).not.toBeNull()
  })
})

describe('a comp is never a paying subscription (AGL-3034)', () => {
  it.each([
    ['dead', { plan: 'pro', billingStatus: 'canceled' }],
    ['absent', { plan: 'pro' }],
    ['absent, no stored plan', {}],
  ])('books no revenue on a %s subscription', (_label, base) => {
    const org = withComp(base, comp('agency'))
    expect(resolveEffectivePlan(org)).toBe('agency')
    expect(isBillingSubscription(org)).toBe(false)
    expect(orgListPriceMonthlyUsd(org)).toBe(0)
    expect(orgMonthlyRevenueUsd(org)).toBe(0)
  })
})

describe('a comp names the plan everywhere the plan is named (AGL-3034)', () => {
  it('reads as Enterprise when comped to it, and not off a plan stored before the comp', () => {
    expect(isEnterpriseOrg(withComp({ billingStatus: 'canceled' }, comp('enterprise')))).toBe(true)
    expect(isEnterpriseOrg(withComp({ plan: 'enterprise' }, comp('scale')))).toBe(false)
    // The explicit marker still counts, and a live subscription ignores the comp.
    expect(isEnterpriseOrg(withComp({ enterprise: true }, comp('pro')))).toBe(true)
    expect(
      isEnterpriseOrg(withComp({ plan: 'enterprise', billingStatus: 'active' }, comp('pro'))),
    ).toBe(true)
  })
})

describe('describing the plan to staff (AGL-3034)', () => {
  it('names what decided it in each state, and says a plan set here is a comp', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ plan: 'pro', billingStatus: 'active' }, 'subscription'],
      [withComp({ plan: 'pro', billingStatus: 'canceled' }, comp('pro')), 'comp'],
      [{ plan: 'pro', billingStatus: 'canceled' }, 'lapsed'],
      [{ plan: 'enterprise' }, 'stored-plan'],
      [{}, 'no-plan'],
    ]
    for (const [org, decidedBy] of cases) {
      const description = describeOrgPlan(org as any)
      expect(description.decidedBy).toBe(decidedBy)
      expect(description.effectivePlan).toBe(resolveEffectivePlan(org as any))
      const sentence = orgPlanDescriptionSentence(description)
      if (decidedBy === 'lapsed' || decidedBy === 'stored-plan' || decidedBy === 'no-plan') {
        expect(sentence).toMatch(/written as a staff comp/)
      }
    }
    expect(
      orgPlanDescriptionSentence(describeOrgPlan({ plan: 'pro', billingStatus: 'canceled' } as any)),
    ).toMatch(/canceled.*Free.*stored Pro grants nothing/)
    expect(
      orgPlanDescriptionSentence(describeOrgPlan(withComp(TEST_ORG, comp('pro')))),
    ).toMatch(/Pro is in force as a staff comp.*bills nothing/)
  })
})
