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

import { AI_CREDIT_BLOCK_MONTHLY_USD, AI_CREDITS_PER_BLOCK } from './ai-credit-blocks'
import {
  ORG_COGS_UNIT_RATES_USD,
  PLAN_PRICING,
  POS_REGISTER_ADDON_MONTHLY_USD,
  aiCreditsQuotaPerUnit,
  checkApiRequestQuota,
  checkDataStorageQuota,
  checkSeatQuota,
  contractMonth,
  contractUsageBill,
  defaultContractRates,
  nextContractMonth,
  orgListPriceMonthlyUsd,
  orgSellsAiCreditBlocks,
  readOrgContract,
  resolvePlanPricing,
  resolveOrgEntitlements,
  withoutContractCeilingFlag,
  type ResolvedContractRates,
} from './plan-entitlements'
import {
  FULL_USE_QUOTE_MULTIPLE,
  checkContractRates,
  contractAdditionFloor,
  describeContractRateFailures,
} from './full-use-cost'
import { parseContractTerms } from './contract-terms'

const THIS_MONTH = contractMonth()
const LAST_MONTH = (() => {
  const [year, month] = THIS_MONTH.split('-').map(Number)
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7)
})()

/** A live Custom workspace at a negotiated base, with or without a rate card. */
const custom = (contract?: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({
    plan: 'enterprise',
    subscription: { status: 'active', interval: 'month', customMonthlyUsd: 5000 },
    ...(contract ? { entitlements: { contract } } : {}),
    ...extra,
  }) as never

describe('the default rate card is the public Pro rates, read from code (AGL-4233)', () => {
  it('matches PLAN_PRICING.pro and the flat add-on constants', () => {
    const pro = PLAN_PRICING.pro
    expect(defaultContractRates()).toEqual({
      extraHostMonthlyUsd: pro.extraHostMonthlyUsd,
      extraSeatMonthlyUsd: pro.extraSeatMonthlyUsd,
      extraCollaboratorMonthlyUsd: pro.extraCollaboratorMonthlyUsd,
      extraDatasetMonthlyUsd: pro.extraDatasetMonthlyUsd,
      posRegisterMonthlyUsd: POS_REGISTER_ADDON_MONTHLY_USD,
      aiCreditBlockMonthlyUsd: AI_CREDIT_BLOCK_MONTHLY_USD,
      extraDataGbMonthlyUsd: pro.extraDataGbMonthlyUsd,
      extraApiRequestsUsdPer1k: pro.extraApiRequestsUsdPer1k,
      extraAssistCreditsUsdPer1k: pro.extraAssistCreditsUsdPer1k,
      extraContactsUsdPer1k: pro.extraContactsUsdPer1k,
      extraEmailSendsUsdPer1k: pro.extraEmailSendsUsdPer1k,
      extraRunsUsdPer1k: pro.extraRunsUsdPer1k,
      meteredInfraPassThrough: pro.meteredInfraPassThrough,
    })
  })

  it('a negotiated rate replaces only its own key; null means not sold', () => {
    const contract = readOrgContract(
      custom({ rates: { extraSeatMonthlyUsd: 3, posRegisterMonthlyUsd: null } }),
    )
    expect(contract?.rates.extraSeatMonthlyUsd).toBe(3)
    expect(contract?.rates.posRegisterMonthlyUsd).toBeNull()
    expect(contract?.rates.extraHostMonthlyUsd).toBe(PLAN_PRICING.pro.extraHostMonthlyUsd)
  })
})

describe('a Custom workspace WITHOUT a rate card is unchanged (AGL-4233)', () => {
  const org = custom()

  it('has no contract and resolves the all-null Custom row', () => {
    expect(readOrgContract(org)).toBeNull()
    expect(resolvePlanPricing(org)).toEqual(PLAN_PRICING.enterprise)
  })

  it('sells no seat, refuses past its bands, and lists at the quote alone', () => {
    expect(checkSeatQuota(org, 'managers', 0).upgradeRequired).toBe(true)
    const included = resolveOrgEntitlements(org).apiRequestsPerMonth
    expect(checkApiRequestQuota(org, included + 1).allowed).toBe(false)
    expect(checkDataStorageQuota(org, 10_000_000).allowed).toBe(false)
    expect(orgListPriceMonthlyUsd({ ...(org as object), seatAddons: { hosts: 3 } } as never)).toBe(5000)
    expect(contractUsageBill(org, THIS_MONTH, 12_345)).toEqual({
      billedCents: 12_345,
      ceilingCents: 0,
      ceilingReached: false,
    })
    expect(orgSellsAiCreditBlocks(org)).toBe(false)
    expect(aiCreditsQuotaPerUnit(org, 'enterprise')).toBe(298_000)
  })

  it('a rate card on a workspace that is not on Custom, or is comped, does nothing', () => {
    expect(readOrgContract({ ...(custom({}) as object), plan: 'pro' } as never)).toBeNull()
    expect(
      readOrgContract({
        plan: 'enterprise',
        entitlements: {
          contract: {},
          planComp: { plan: 'enterprise', reason: 'partner', note: null, grantedBy: 'x', grantedAt: null },
        },
      } as never),
    ).toBeNull()
  })
})

describe('a contract with a rate card sells additions (AGL-4233)', () => {
  const org = custom({ rates: { extraHostMonthlyUsd: 15 }, usageCeilingMonthlyUsd: 400 })

  it('sells seats at its rate; usage stays a wall while usage billing is off', () => {
    const pricing = resolvePlanPricing(org)
    expect(pricing.extraHostMonthlyUsd).toBe(15)
    expect(pricing.extraSeatMonthlyUsd).toBe(PLAN_PRICING.pro.extraSeatMonthlyUsd)
    expect(pricing.extraApiRequestsUsdPer1k).toBeNull()
    expect(pricing.meteredInfraPassThrough).toBe(false)
    expect(checkSeatQuota(org, 'managers', 0).upgradeRequired).toBe(false)
    const included = resolveOrgEntitlements(org).apiRequestsPerMonth
    expect(checkApiRequestQuota(org, included + 1).allowed).toBe(false)
  })

  it('lists at the quote plus its additions at the contract rates', () => {
    const bought = { ...(org as object), seatAddons: { hosts: 2, managers: 5, aiAddon: 3 } } as never
    expect(orgListPriceMonthlyUsd(bought)).toBe(5000 + 2 * 15 + 5 * 4 + 3 * AI_CREDIT_BLOCK_MONTHLY_USD)
  })

  it('an AI credit block on a contract is the same 5,000-credit block every plan sells', () => {
    expect(orgSellsAiCreditBlocks(org)).toBe(true)
    expect(aiCreditsQuotaPerUnit(org, 'enterprise')).toBe(AI_CREDITS_PER_BLOCK)
  })
})

describe('usage past the contract bills automatically, up to the ceiling (AGL-4233)', () => {
  const billing = (extra: Record<string, unknown> = {}) =>
    custom({
      usageBilling: true,
      usageCeilingMonthlyUsd: 400,
      usageBillingFrom: THIS_MONTH,
      ...extra,
    })

  it('meters instead of refusing, at the contract rates', () => {
    const org = billing()
    const pricing = resolvePlanPricing(org)
    expect(pricing.extraApiRequestsUsdPer1k).toBe(PLAN_PRICING.pro.extraApiRequestsUsdPer1k)
    expect(pricing.meteredInfraPassThrough).toBe(true)
    const included = resolveOrgEntitlements(org).apiRequestsPerMonth
    const quota = checkApiRequestQuota(org, included + 10_000)
    expect(quota.allowed).toBe(true)
    expect(quota.overageMonthlyUsd).toBe(10 * 0.5)
    expect(checkDataStorageQuota(org, 10_000_000).allowed).toBe(true)
  })

  it('a negotiated usage rate is the one billed', () => {
    const org = billing({ rates: { extraApiRequestsUsdPer1k: 0.4 } })
    const included = resolveOrgEntitlements(org).apiRequestsPerMonth
    expect(checkApiRequestQuota(org, included + 10_000).overageMonthlyUsd).toBe(4)
  })

  it('does not bill before the month it starts', () => {
    const org = billing({ usageBillingFrom: nextContractMonth(THIS_MONTH) })
    expect(resolvePlanPricing(org).extraApiRequestsUsdPer1k).toBeNull()
    expect(contractUsageBill(org, THIS_MONTH, 10_000).billedCents).toBe(0)
  })

  it('a month never bills past the ceiling, and reaching it says so', () => {
    const org = billing()
    expect(contractUsageBill(org, THIS_MONTH, 25_000)).toEqual({
      billedCents: 25_000,
      ceilingCents: 40_000,
      ceilingReached: false,
    })
    expect(contractUsageBill(org, THIS_MONTH, 90_000)).toEqual({
      billedCents: 40_000,
      ceilingCents: 40_000,
      ceilingReached: true,
    })
  })

  it('at the ceiling the hard caps return for the rest of the month — and only that month', () => {
    const reached = billing({ ceilingReachedMonth: THIS_MONTH })
    expect(resolvePlanPricing(reached).extraApiRequestsUsdPer1k).toBeNull()
    const included = resolveOrgEntitlements(reached).apiRequestsPerMonth
    expect(checkApiRequestQuota(reached, included + 1).allowed).toBe(false)
    // The addition rates stay: the ceiling is about usage, not purchases.
    expect(resolvePlanPricing(reached).extraHostMonthlyUsd).toBe(20)
    // A flag from an earlier month does not hold this one.
    expect(
      resolvePlanPricing(billing({ ceilingReachedMonth: LAST_MONTH })).extraApiRequestsUsdPer1k,
    ).toBe(0.5)
  })

  it('the rollup prices a reached month with the flag set aside, so it still bills to the ceiling', () => {
    const reached = billing({ ceilingReachedMonth: THIS_MONTH })
    const priced = withoutContractCeilingFlag(reached)
    expect(resolvePlanPricing(priced).extraApiRequestsUsdPer1k).toBe(0.5)
    expect(contractUsageBill(priced, THIS_MONTH, 90_000).billedCents).toBe(40_000)
  })

  it('usage billing off keeps today’s hard caps exactly', () => {
    const org = custom({ usageBilling: false, usageCeilingMonthlyUsd: 400 })
    expect(contractUsageBill(org, THIS_MONTH, 10_000).billedCents).toBe(0)
    for (const key of [
      'extraDataGbMonthlyUsd',
      'extraApiRequestsUsdPer1k',
      'extraAssistCreditsUsdPer1k',
      'extraContactsUsdPer1k',
      'extraEmailSendsUsdPer1k',
      'extraRunsUsdPer1k',
    ] as const) {
      expect(resolvePlanPricing(org)[key]).toBeNull()
    }
  })
})

describe('the contract rate guard: cost + 30% at full use (AGL-4233)', () => {
  it('the public Pro defaults clear it on a Custom deal', () => {
    const verdict = checkContractRates(custom({}), defaultContractRates())
    expect(verdict.failures).toEqual([])
    expect(verdict.ok).toBe(true)
  })

  it('a rate under the floor is refused with the figures', () => {
    const rates = { ...defaultContractRates(), extraApiRequestsUsdPer1k: 0.1 }
    const verdict = checkContractRates(custom({}), rates)
    expect(verdict.ok).toBe(false)
    const [failure] = verdict.failures
    expect(failure.key).toBe('extraApiRequestsUsdPer1k')
    expect(failure.unitCostUsd).toBeCloseTo(ORG_COGS_UNIT_RATES_USD.perApiRequest * 1000, 6)
    expect(failure.floorUsd).toBeCloseTo(
      (FULL_USE_QUOTE_MULTIPLE * ORG_COGS_UNIT_RATES_USD.perApiRequest * 1000) / (1 - 0.029),
      6,
    )
    expect(describeContractRateFailures(verdict)).toMatch(/API requests \(per 1,000\) at \$0\.10 is under \$0\.16/)
  })

  it('an extra site costs every per-site band the contract sets', () => {
    const rates = { ...defaultContractRates(), extraHostMonthlyUsd: 1 }
    const verdict = checkContractRates(custom({}), rates)
    expect(verdict.failures.map((check) => check.key)).toEqual(['extraHostMonthlyUsd'])
    expect(verdict.failures[0].unitCostUsd).toBeGreaterThan(1)
  })

  it('an AI credit block costs its credits', () => {
    const rates = { ...defaultContractRates(), aiCreditBlockMonthlyUsd: 5 }
    const verdict = checkContractRates(custom({}), rates)
    expect(verdict.failures.map((check) => check.key)).toContain('aiCreditBlockMonthlyUsd')
  })

  it('a rate that sells nothing is not rated', () => {
    const rates: ResolvedContractRates = { ...defaultContractRates(), posRegisterMonthlyUsd: null }
    const verdict = checkContractRates(custom({}), rates)
    expect(verdict.checks.map((check) => check.key)).not.toContain('posRegisterMonthlyUsd')
  })

  it('an addition re-rates the whole contract against the quote floor', () => {
    expect(contractAdditionFloor(custom({}), { hosts: 1 }).ok).toBe(true)
    const thin = {
      ...(custom({}) as object),
      subscription: { status: 'active', interval: 'month', customMonthlyUsd: 10 },
    } as never
    expect(contractAdditionFloor(thin, { hosts: 1 }).ok).toBe(false)
  })
})

describe('staff input becomes stored terms (AGL-4233)', () => {
  const NOW = Date.UTC(2026, 10, 16, 12)

  it('stores only the rates that differ from Pro, and the ceiling as a figure', () => {
    const parsed = parseContractTerms(
      {
        rates: { extraSeatMonthlyUsd: '3', extraHostMonthlyUsd: 20, posRegisterMonthlyUsd: null },
        usageBilling: true,
      },
      { baseMonthlyUsd: 5000, nowMs: NOW, setBy: 'staff-1' },
    )
    expect(parsed.ok).toBe(true)
    expect(parsed.terms).toEqual({
      rates: { extraSeatMonthlyUsd: 3, posRegisterMonthlyUsd: null },
      usageBilling: true,
      usageCeilingMonthlyUsd: 5000,
      usageBillingFrom: '2026-12',
      ceilingReachedMonth: null,
      setBy: 'staff-1',
      setAtMs: NOW,
    })
  })

  it('keeps the month billing started while it stays on', () => {
    const parsed = parseContractTerms(
      { usageBilling: true, usageCeilingMonthlyUsd: 250 },
      {
        previous: { usageBilling: true, usageBillingFrom: '2026-09' },
        nowMs: NOW,
        setBy: 'staff-1',
      },
    )
    expect(parsed.terms?.usageBillingFrom).toBe('2026-09')
    expect(parsed.terms?.usageCeilingMonthlyUsd).toBe(250)
  })

  it('refuses a negative rate, and usage billing with no ceiling to bill under', () => {
    expect(
      parseContractTerms({ rates: { extraSeatMonthlyUsd: -1 } }, { setBy: 'staff-1' }).ok,
    ).toBe(false)
    const noCeiling = parseContractTerms({ usageBilling: true }, { baseMonthlyUsd: 0, setBy: 'staff-1' })
    expect(noCeiling.ok).toBe(false)
    expect(noCeiling.error).toMatch(/ceiling/)
  })
})
