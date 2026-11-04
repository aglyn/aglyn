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
  AI_CREDIT_BLOCK,
  AI_CREDIT_BLOCK_ENV_KEY,
  AI_CREDIT_BLOCK_LOOKUP_KEYS,
  AI_CREDIT_BLOCK_MONTHLY_USD,
  AI_CREDIT_BLOCK_PRICE_ENV,
  AI_CREDIT_BLOCK_TERMS,
  AI_CREDIT_BLOCK_USD_PER_1K,
  AI_CREDIT_BLOCK_YEARLY_USD,
  AI_CREDIT_BLOCKS_MAX,
  AI_CREDIT_BLOCKS_MIN,
  AI_CREDITS_PER_BLOCK,
  aiCreditBlockCount,
  aiCreditBlockPriceEnvName,
  aiCreditBlocksCredits,
  aiCreditBlocksLabel,
  aiCreditBlocksMonthlyUsd,
  aiCreditBlocksPriceUsd,
  describeAiCreditBlocks,
  includedAiCreditsPerMonth,
} from './ai-credit-blocks'
import {
  aiAddonUnits,
  aiCreditBlocksCreditsPerMonth,
  aiCreditsQuotaPerUnit,
  ENTERPRISE_AI_ADDON_CREDITS_PER_MONTH,
  orgCanBuyAiCredits,
  orgListPriceMonthlyUsd,
  PLAN_ENTITLEMENTS,
  PLAN_PRICING,
  planSellsAiCredits,
  resolveAiCreditBlocks,
  resolveOrgEntitlements,
  SELF_SERVE_PLANS,
  UNLIMITED,
} from './plan-entitlements'
import { registerPluginEntitlements } from '../plugin-manager/plugin-entitlements'
import type { AglynOrgBilling, OrgPlan } from '../foundation'

// The AI add-on as its plugin declares it (`libs/plugins/ai/src/lib/declarations.ts`):
// the resolver folds whatever is declared, and this library compiles without
// the plugin, so the spec declares it the same way.
registerPluginEntitlements({
  pluginId: 'ai',
  seatAddons: [
    {
      key: 'aiAddon',
      label: 'AI add-on',
      maxUnits: AI_CREDIT_BLOCKS_MAX,
      quota: { key: 'assistCreditsPerMonth', perUnit: aiCreditsQuotaPerUnit },
      soldOn: planSellsAiCredits,
      features: ['aiGenerative', 'aiAssist'],
    },
  ],
})

declare module '../plugin-manager/plugin-entitlement-keys' {
  interface PluginEntitlementQuotas {
    assistCreditsPerMonth?: number
  }
}

/**
 * THE AGLYN AI CREDIT BLOCK (AGL-4144): 5,000 credits for $10 a month, any
 * quantity from 1 to 30, on any paid self-serve plan. These pin the block,
 * the included-credits arithmetic, and that the resolver and the list price
 * read the same count.
 */
describe('the Aglyn AI credit block', () => {
  it('is 5,000 credits for $10 a month, $120 a year, up to 30 blocks', () => {
    expect(AI_CREDITS_PER_BLOCK).toBe(5_000)
    expect(AI_CREDIT_BLOCK_MONTHLY_USD).toBe(10)
    expect(AI_CREDIT_BLOCK_YEARLY_USD).toBe(120)
    expect(AI_CREDIT_BLOCKS_MIN).toBe(0)
    expect(AI_CREDIT_BLOCKS_MAX).toBe(30)
    expect(AI_CREDIT_BLOCK).toEqual({
      credits: 5_000,
      monthlyUsd: 10,
      yearlyUsd: 120,
      maxBlocks: 30,
      lookupKeys: { month: 'aglyn_ai_credits', year: 'aglyn_ai_credits_yearly' },
      priceEnv: { month: 'STRIPE_PRICE_AI_CREDITS', year: 'STRIPE_PRICE_AI_CREDITS_YEARLY' },
    })
  })

  it('names the Stripe lookup keys and the env vars the console reads', () => {
    expect(AI_CREDIT_BLOCK_LOOKUP_KEYS).toEqual({
      month: 'aglyn_ai_credits',
      year: 'aglyn_ai_credits_yearly',
    })
    expect(AI_CREDIT_BLOCK_PRICE_ENV).toEqual({
      month: 'STRIPE_PRICE_AI_CREDITS',
      year: 'STRIPE_PRICE_AI_CREDITS_YEARLY',
    })
    expect(AI_CREDIT_BLOCK_ENV_KEY).toBe('AI_CREDITS')
    expect(aiCreditBlockPriceEnvName('month')).toBe('STRIPE_PRICE_AI_CREDITS')
    expect(aiCreditBlockPriceEnvName('year')).toBe('STRIPE_PRICE_AI_CREDITS_YEARLY')
  })

  it('sells 1,000 credits at $2, the rate the top retired tier charged', () => {
    expect(AI_CREDIT_BLOCK_USD_PER_1K).toBe(2)
  })

  it('states its terms in the words the Billing stepper prints', () => {
    expect(AI_CREDIT_BLOCK_TERMS).toBe('5,000 credits each, $10 a month per block')
  })
})

describe('aiCreditBlockCount: a stored quantity as blocks, 0 to 30', () => {
  it('reads the bounds and everything between them as themselves', () => {
    expect(aiCreditBlockCount(0)).toBe(0)
    expect(aiCreditBlockCount(1)).toBe(1)
    expect(aiCreditBlockCount(17)).toBe(17)
    expect(aiCreditBlockCount(30)).toBe(30)
  })

  it('holds anything above the ceiling to 30', () => {
    expect(aiCreditBlockCount(31)).toBe(30)
    expect(aiCreditBlockCount(999)).toBe(30)
    expect(aiCreditBlockCount(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('reads junk as none and rounds a fraction down', () => {
    for (const junk of [undefined, null, '', 'boost', Number.NaN, -1, 0.5, {}, []]) {
      expect(aiCreditBlockCount(junk)).toBe(0)
    }
    expect(aiCreditBlockCount(2.9)).toBe(2)
    expect(aiCreditBlockCount('3')).toBe(3)
  })
})

describe('the included-credits arithmetic: plan band + blocks × 5,000', () => {
  it('adds 5,000 a block to the band', () => {
    expect(includedAiCreditsPerMonth(750, 0)).toBe(750)
    expect(includedAiCreditsPerMonth(750, 1)).toBe(5_750)
    expect(includedAiCreditsPerMonth(750, 3)).toBe(15_750)
    expect(includedAiCreditsPerMonth(750, 30)).toBe(150_750)
  })

  it('never adds more than 30 blocks, however many are stored', () => {
    expect(includedAiCreditsPerMonth(750, 45)).toBe(150_750)
  })

  it('keeps an unlimited band unlimited and reads a missing band as none', () => {
    expect(includedAiCreditsPerMonth(UNLIMITED, 3)).toBe(UNLIMITED)
    expect(includedAiCreditsPerMonth(Number.NaN, 2)).toBe(10_000)
    expect(includedAiCreditsPerMonth(-5, 2)).toBe(10_000)
  })

  it('prices and words the blocks the same way', () => {
    expect(aiCreditBlocksCredits(3)).toBe(15_000)
    expect(aiCreditBlocksMonthlyUsd(3)).toBe(30)
    expect(aiCreditBlocksPriceUsd(3, 'month')).toBe(30)
    expect(aiCreditBlocksPriceUsd(3, 'year')).toBe(360)
    expect(aiCreditBlocksMonthlyUsd(40)).toBe(300)
    expect(aiCreditBlocksLabel(1)).toBe('1 block')
    expect(aiCreditBlocksLabel(3)).toBe('3 blocks')
    expect(describeAiCreditBlocks(3)).toBe('3 blocks · 15,000 credits a month')
  })
})

/** A live paying org on a plan, holding `blocks`. */
const org = (plan: OrgPlan, blocks: unknown, status = 'active'): Partial<AglynOrgBilling> =>
  ({
    plan,
    subscription: { status },
    seatAddons: { aiAddon: blocks },
  }) as never

const PAID = SELF_SERVE_PLANS.filter((plan) => plan !== 'free')

describe('the blocks as the resolver and the list price read them', () => {
  it('is sold on every paid self-serve plan and on nothing else', () => {
    for (const plan of PAID) expect(planSellsAiCredits(plan)).toBe(true)
    expect(planSellsAiCredits('free')).toBe(false)
    expect(planSellsAiCredits('enterprise')).toBe(false)
    expect(planSellsAiCredits('boost')).toBe(false)
  })

  it('widens the plan band by 5,000 a block, the same figure the arithmetic gives', () => {
    for (const plan of PAID) {
      const band = PLAN_ENTITLEMENTS[plan].assistCreditsPerMonth
      for (const blocks of [0, 1, 3, 30, 31]) {
        const held = org(plan, blocks)
        expect(resolveOrgEntitlements(held).assistCreditsPerMonth).toBe(
          includedAiCreditsPerMonth(band, blocks),
        )
        expect(resolveAiCreditBlocks(held)).toBe(Math.min(30, blocks))
        expect(aiCreditBlocksCreditsPerMonth(held)).toBe(Math.min(30, blocks) * 5_000)
      }
    }
  })

  it('bills $10 a block on the list price, on top of the plan', () => {
    const base = orgListPriceMonthlyUsd(org('pro', 0))
    expect(orgListPriceMonthlyUsd(org('pro', 3))).toBe(base + 30)
    expect(orgListPriceMonthlyUsd(org('pro', 30))).toBe(base + 300)
    expect(orgListPriceMonthlyUsd(org('pro', 45))).toBe(base + 300)
    expect(base).toBe(PLAN_PRICING.pro.basePriceMonthlyUsd)
  })

  it('drops every block on a dead subscription', () => {
    const dead = org('pro', 3, 'canceled')
    expect(resolveAiCreditBlocks(dead)).toBe(0)
    expect(aiCreditBlocksCreditsPerMonth(dead)).toBe(0)
    expect(resolveOrgEntitlements(dead).assistCreditsPerMonth).toBe(
      PLAN_ENTITLEMENTS.free.assistCreditsPerMonth,
    )
  })

  it('sells none on Free, and keeps the agreement figure per unit on Enterprise', () => {
    expect(aiCreditsQuotaPerUnit(null, 'free')).toBe(0)
    expect(aiCreditsQuotaPerUnit(null, 'pro')).toBe(5_000)
    expect(aiCreditsQuotaPerUnit(null, 'enterprise')).toBe(ENTERPRISE_AI_ADDON_CREDITS_PER_MONTH)
    expect(ENTERPRISE_AI_ADDON_CREDITS_PER_MONTH).toBe(298_000)
    expect(resolveAiCreditBlocks(org('enterprise', 1))).toBe(0)
    expect(orgCanBuyAiCredits(org('free', 0))).toBe(false)
    expect(orgCanBuyAiCredits(org('starter', 0))).toBe(true)
  })

  it('reads no retired tier: a stored tier id adds nothing and is no count', () => {
    const stale = { ...org('pro', 0), aiTier: 'studio' } as never
    expect(resolveAiCreditBlocks(stale)).toBe(0)
    expect(resolveOrgEntitlements(stale).assistCreditsPerMonth).toBe(
      PLAN_ENTITLEMENTS.pro.assistCreditsPerMonth,
    )
    expect(aiAddonUnits({ aiAddon: 'boost' as never })).toBe(0)
  })
})
