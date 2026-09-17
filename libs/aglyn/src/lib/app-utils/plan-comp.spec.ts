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
 *
 * AGL-3049 adds the UNCAPPED comp — every band and quota unlimited, for an
 * internal workspace — and pins the rules that keep it safe: it never refuses
 * at a band, it is never billable, a live subscription ignores it, removing
 * the flag restores the plan's caps, and a capped comp with one band raised
 * refuses only past that band.
 */

import {
  assistBandRefuses,
  assistMonthOverage,
  priceAssistCreditOverage,
  resolveAssistCreditBudget,
  resolveAssistOverageRateUsdPer1k,
} from './assist-credits'
import {
  AI_ADDON_CREDITS_PER_MONTH,
  apiRequestEnforcementShape,
  checkApiRequestQuota,
  checkCrmEmailQuota,
  checkCrmRecordsQuota,
  checkDataStorageQuota,
  checkDatasetQuota,
  checkEntitlement,
  checkFormSubmissionQuota,
  checkHostCollaboratorQuota,
  checkHostRegisterQuota,
  checkQuota,
  checkSeatQuota,
  dataStorageEnforcementShape,
  describeOrgPlan,
  hasAiAddon,
  isBillingSubscription,
  isEnterpriseOrg,
  isUncappedPlanComp,
  orgListPriceMonthlyUsd,
  orgMonthlyRevenueUsd,
  orgPlanDescriptionSentence,
  orgSubscriptionState,
  PLAN_ENTITLEMENTS,
  PLAN_PRICING,
  planCompLabel,
  planCompPhrase,
  planMetersInfraOverage,
  PRICE_ENTITLEMENT_KEYS,
  priceEmailSendOverage,
  readOrgPlanComp,
  resolveEffectivePlan,
  resolveOrgEntitlements,
  resolvePlanComp,
  resolvePlanPricing,
  UNLIMITED,
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
      uncapped: false,
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

/** An uncapped comp as the override route writes it (AGL-3049). */
const uncappedComp = (plan: string, extra: Record<string, unknown> = {}) =>
  comp(plan, { uncapped: true, reason: 'other', note: 'Internal workspace', ...extra })

/** Every numeric key a plan row carries: the bands, and the prices. */
const NUMERIC_KEYS = Object.entries(PLAN_ENTITLEMENTS.free)
  .filter(([, value]) => typeof value === 'number')
  .map(([key]) => key)
  .sort()

/** The bands alone — every numeric key an uncapped comp lifts. */
const BAND_KEYS = NUMERIC_KEYS.filter((key) => !PRICE_ENTITLEMENT_KEYS.has(key))

/**
 * An internal workspace the way aglyn-org would carry one: no subscription,
 * Enterprise stored before comps, a staff override on two bands and a fee,
 * a staff-set extra-sites quantity, and a feature forced off.
 */
const INTERNAL = {
  plan: 'enterprise',
  enterprise: true,
  seatAddons: { hosts: 3 },
  entitlements: {
    contactsPerHost: 50,
    assistCreditsPerMonth: 5000,
    marketplaceFeePct: 12,
    features: { ssoEnabled: false },
  },
}

describe('an uncapped comp lifts every cap (AGL-3049)', () => {
  it('reads every band and quota as unlimited, over the plan row, the overrides and the add-ons', () => {
    const org = withComp(INTERNAL, uncappedComp('enterprise'))
    expect(isUncappedPlanComp(org)).toBe(true)
    const resolved = resolveOrgEntitlements(org) as unknown as Record<string, unknown>
    const lifted = Object.keys(resolved)
      .filter((key) => resolved[key] === UNLIMITED)
      .sort()
    expect(lifted).toEqual(BAND_KEYS)
    // The capped reading of the same document, for the control on every key
    // the lift must NOT touch.
    const capped = resolveOrgEntitlements(
      withComp(INTERNAL, comp('enterprise')),
    ) as unknown as Record<string, unknown>
    expect(capped['contactsPerHost']).toBe(50)
    expect(capped['assistCreditsPerMonth']).toBe(5000)
    expect(resolved['features']).toEqual(capped['features'])
    expect((resolved['features'] as Record<string, boolean>)['ssoEnabled']).toBe(false)
    expect('planComp' in resolved).toBe(false)
  })

  it('never lifts a price: the fee percentages are the ones listed, and stay as resolved', () => {
    // Named, so a new numeric key is a band unless someone decides here that
    // it is a price. Lifted to Infinity, a transaction fee would be larger
    // than the charge and every sale would fail at checkout.
    expect([...PRICE_ENTITLEMENT_KEYS].sort()).toEqual([
      'marketplaceFeePct',
      'transactionFeeDigitalPct',
      'transactionFeePhysicalPct',
    ])
    for (const key of PRICE_ENTITLEMENT_KEYS) expect(NUMERIC_KEYS).toContain(key)
    const resolved = resolveOrgEntitlements(withComp(INTERNAL, uncappedComp('enterprise')))
    expect(resolved.marketplaceFeePct).toBe(12)
    expect(resolved.transactionFeePhysicalPct).toBe(
      PLAN_ENTITLEMENTS.enterprise.transactionFeePhysicalPct,
    )
    const starter = resolveOrgEntitlements(withComp({}, uncappedComp('starter')))
    expect(starter.transactionFeeDigitalPct).toBe(PLAN_ENTITLEMENTS.starter.transactionFeeDigitalPct)
    expect(starter.marketplaceFeePct).toBe(PLAN_ENTITLEMENTS.starter.marketplaceFeePct)
  })

  it('never refuses at a band, on any gate the plan module answers', () => {
    const org = withComp({ billingStatus: 'canceled' }, uncappedComp('starter'))
    const huge = 1_000_000_000
    for (const key of BAND_KEYS) {
      const verdict = checkQuota(org, key as never, huge)
      expect(`${key}: ${verdict.allowed}`).toBe(`${key}: true`)
    }
    expect(checkSeatQuota(org, 'managers', huge).allowed).toBe(true)
    expect(checkSeatQuota(org, 'members', huge).allowed).toBe(true)
    expect(checkHostCollaboratorQuota(org, 'host-1', huge).allowed).toBe(true)
    expect(checkHostRegisterQuota(org, 'host-1', huge).allowed).toBe(true)
    expect(checkDatasetQuota(org, huge).allowed).toBe(true)
    expect(checkDataStorageQuota(org, huge).allowed).toBe(true)
    expect(checkApiRequestQuota(org, huge).allowed).toBe(true)
    expect(checkCrmRecordsQuota(org, huge).allowed).toBe(true)
    expect(checkCrmEmailQuota(org, huge).allowed).toBe(true)
    expect(checkFormSubmissionQuota(org, huge).allowed).toBe(true)
    expect(dataStorageEnforcementShape(org)).toBe('never-blocks')
    expect(apiRequestEnforcementShape(org)).toBe('never-blocks')
    // The AI band: no band to be a wall at, and none to measure against.
    expect(assistBandRefuses(org)).toBe(false)
    expect(resolveAssistCreditBudget(org)).toBeNull()

    // The control: the same Starter comp, capped, refuses at its bands —
    // so the verdicts above are the lift's, not a gate that never refuses.
    const capped = withComp({ billingStatus: 'canceled' }, comp('starter'))
    const band = PLAN_ENTITLEMENTS.starter
    expect(checkQuota(capped, 'screensPerHost', band.screensPerHost).allowed).toBe(false)
    expect(checkCrmRecordsQuota(capped, band.contactsPerHost).allowed).toBe(false)
    expect(checkCrmEmailQuota(capped, band.crmEmailsPerDay).allowed).toBe(false)
    expect(checkFormSubmissionQuota(capped, band.formSubmissionsPerMonth).allowed).toBe(false)
    expect(dataStorageEnforcementShape(capped)).toBe('measure')
    expect(assistBandRefuses(capped)).toBe(true)
  })

  it('is never billable: every rate withheld, no overage priced, no revenue booked', () => {
    const org = withComp(INTERNAL, uncappedComp('agency'))
    const pricing = resolvePlanPricing(org)
    expect(pricing).toEqual(resolvePlanPricing(withComp(INTERNAL, comp('agency'))))
    for (const [key, value] of Object.entries(pricing)) {
      if (key.startsWith('basePrice')) continue
      expect(`${key}: ${value}`).toBe(`${key}: ${typeof value === 'boolean' ? false : null}`)
    }
    expect(planMetersInfraOverage(org)).toBe(false)
    const month = assistMonthOverage(org, 1_000_000)
    expect(month).toMatchObject({
      bandCredits: null,
      overageCredits: 0,
      overageMonthlyUsd: 0,
      overageRateUsd: null,
    })
    expect(resolveAssistOverageRateUsdPer1k(org)).toBeNull()
    expect(priceAssistCreditOverage(org, 1_000_000).overageMonthlyUsd).toBe(0)
    expect(priceEmailSendOverage(org, 1_000_000).overageMonthlyUsd).toBe(0)
    expect(checkCrmRecordsQuota(org, 1_000_000_000)).toMatchObject({
      overageRecords: 0,
      overageMonthlyUsd: 0,
    })
    expect(checkApiRequestQuota(org, 1_000_000_000).overageMonthlyUsd).toBe(0)
    expect(checkDataStorageQuota(org, 1_000_000_000).overageMonthlyUsd).toBe(0)
    expect(isBillingSubscription(org)).toBe(false)
    expect(orgListPriceMonthlyUsd(org)).toBe(0)
    expect(orgMonthlyRevenueUsd(org)).toBe(0)
  })

  it('is ignored while a live subscription is in force, and lifts again when it ends', () => {
    const live = withComp(
      { plan: 'starter', billingStatus: 'active', entitlements: { contactsPerHost: 2000 } },
      uncappedComp('agency'),
    )
    expect(isUncappedPlanComp(live)).toBe(false)
    expect(resolveEffectivePlan(live)).toBe('starter')
    const resolved = resolveOrgEntitlements(live)
    expect(resolved.screensPerHost).toBe(PLAN_ENTITLEMENTS.starter.screensPerHost)
    expect(resolved.contactsPerHost).toBe(2000)
    expect(Object.values(resolved).includes(UNLIMITED)).toBe(false)
    expect(checkQuota(live, 'hostLimit', PLAN_ENTITLEMENTS.starter.hostLimit).allowed).toBe(false)
    // The paying workspace's AI band is sold past as Starter's own terms say,
    // not lifted: no add-on, no band, so it is a wall like any Starter's.
    expect(assistBandRefuses(live)).toBe(true)
    expect(resolvePlanPricing(live)).toEqual(PLAN_PRICING.starter)
    // Dormant, and said so.
    const description = describeOrgPlan(live)
    expect(description).toMatchObject({
      decidedBy: 'subscription',
      compInForce: false,
      uncapped: false,
      comp: { plan: 'agency', uncapped: true },
    })
    expect(orgPlanDescriptionSentence(description)).toMatch(
      /An uncapped Agency comp is stored and dormant/,
    )

    const ended = { ...live, billingStatus: 'canceled' }
    expect(isUncappedPlanComp(ended)).toBe(true)
    expect(resolveOrgEntitlements(ended).contactsPerHost).toBe(UNLIMITED)
  })

  it('removing uncapped restores the plan’s caps — and the overrides beneath them', () => {
    const uncapped = withComp(INTERNAL, uncappedComp('enterprise'))
    const recapped = withComp(INTERNAL, comp('enterprise', { uncapped: false }))
    expect(resolveOrgEntitlements(uncapped).hostLimit).toBe(UNLIMITED)
    const resolved = resolveOrgEntitlements(recapped)
    // No live subscription, so staff-set add-on quantities still count.
    expect(resolved.hostLimit).toBe(PLAN_ENTITLEMENTS.enterprise.hostLimit + 3)
    expect(resolved.contactsPerHost).toBe(50)
    expect(resolved.screensPerHost).toBe(PLAN_ENTITLEMENTS.enterprise.screensPerHost)
    expect(checkCrmRecordsQuota(recapped, 50).allowed).toBe(false)
    expect(assistBandRefuses(recapped)).toBe(true)
    expect(resolveAssistCreditBudget(recapped)).toBe(5000)
    // And removing the comp outright returns the plan stored before it.
    const removed = { ...INTERNAL, entitlements: { ...INTERNAL.entitlements } }
    expect(resolveEffectivePlan(removed as any)).toBe('enterprise')
    expect(isUncappedPlanComp(removed as any)).toBe(false)
    expect(resolveOrgEntitlements(removed as any).contactsPerHost).toBe(50)
  })

  it.each<[string, unknown]>([
    ['the string "true"', 'true'],
    ['the number 1', 1],
    ['a map', { on: true }],
    ['null', null],
    ['false', false],
  ])('only a literal true uncaps — %s reads as a capped comp that still grants its plan', (_label, uncapped) => {
    const org = withComp({ billingStatus: 'canceled' }, comp('pro', { uncapped }))
    expect(readOrgPlanComp(org)).toMatchObject({ plan: 'pro', uncapped: false })
    expect(resolveEffectivePlan(org)).toBe('pro')
    expect(isUncappedPlanComp(org)).toBe(false)
    expect(resolveOrgEntitlements(org).screensPerHost).toBe(PLAN_ENTITLEMENTS.pro.screensPerHost)
  })
})

describe('a capped comp raises one band at a time (AGL-3049)', () => {
  it('refuses only past the raised band, and every other band stays the plan’s wall', () => {
    const band = PLAN_ENTITLEMENTS.pro
    const raised = band.contactsPerHost * 2
    const org = withComp(
      { billingStatus: 'canceled', entitlements: { contactsPerHost: raised } },
      comp('pro'),
    )
    expect(isUncappedPlanComp(org)).toBe(false)
    // Past the plan's own figure, inside the raised one: admitted.
    expect(checkCrmRecordsQuota(org, band.contactsPerHost).allowed).toBe(true)
    expect(checkCrmRecordsQuota(org, raised - 1).allowed).toBe(true)
    // At the raised figure: refused, and nothing is sold past it.
    expect(checkCrmRecordsQuota(org, raised)).toMatchObject({
      allowed: false,
      overageMonthlyUsd: 0,
    })
    // The bands nobody raised are still the plan's walls.
    expect(checkQuota(org, 'screensPerHost', band.screensPerHost).allowed).toBe(false)
    expect(checkCrmEmailQuota(org, band.crmEmailsPerDay).allowed).toBe(false)
  })

  it('raises the AI band the same way: a wall at the raised figure, priced at nothing', () => {
    const org = withComp(
      { billingStatus: 'canceled', entitlements: { assistCreditsPerMonth: 20_000 } },
      comp('pro'),
    )
    expect(resolveAssistCreditBudget(org)).toBe(20_000)
    expect(assistBandRefuses(org)).toBe(true)
    expect(assistMonthOverage(org, 50).overageMonthlyUsd).toBe(0)
  })
})

describe('naming an uncapped comp to staff (AGL-3049)', () => {
  it('says uncapped wherever the comp is named, and says what the bands do', () => {
    expect(planCompLabel({ plan: 'enterprise', uncapped: true }, true)).toBe(
      'Enterprise (uncapped)',
    )
    expect(planCompLabel({ plan: 'pro', uncapped: false }, true)).toBe('Pro')
    expect(planCompLabel({ plan: 'pro', uncapped: false }, false)).toBe('Pro (dormant)')
    expect(planCompLabel({ plan: 'agency', uncapped: true }, false)).toBe(
      'Agency (uncapped, dormant)',
    )
    // The surfaces that show plan keys name the comp by its key.
    expect(planCompLabel({ plan: 'agency', uncapped: true }, true, 'agency')).toBe(
      'agency (uncapped)',
    )
    expect(planCompPhrase({ plan: 'enterprise', uncapped: true })).toBe(
      'uncapped Enterprise comp',
    )
    expect(planCompPhrase({ plan: 'pro', uncapped: false })).toBe('Pro comp')

    const uncapped = describeOrgPlan(withComp(INTERNAL, uncappedComp('enterprise')))
    expect(uncapped).toMatchObject({ decidedBy: 'comp', compInForce: true, uncapped: true })
    expect(orgPlanDescriptionSentence(uncapped)).toMatch(
      /Enterprise is in force as an uncapped staff comp.*bills nothing, every band and quota reads as unlimited/,
    )
    const capped = describeOrgPlan(withComp(TEST_ORG, comp('pro')))
    expect(capped.uncapped).toBe(false)
    expect(orgPlanDescriptionSentence(capped)).toMatch(
      /Pro is in force as a staff comp.*every band is a hard limit that a quota override can raise/,
    )
  })
})
