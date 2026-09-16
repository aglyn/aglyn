/**
 * @jest-environment node
 */
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

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AI_FALLBACK_RATES,
  AI_METER_SENTINELS,
  AI_MODEL_CATALOG,
  aiBilledRatesForModel,
  aiProviderRatesForModel,
  aiRatesAtList,
  estimateAiBilledUsd,
  estimateAiProviderCostUsd,
  type AiTokenRates,
} from './catalog'
import {
  ASSIST_CREDIT_COST_USD,
  ASSIST_CREDIT_MIN_MARGIN_PCT,
  ASSIST_PROVIDER_COST_FIELD,
  assistCreditRateMarginPct,
  assistCreditsFromUsd,
  assistProviderCostUsd,
} from '@aglyn/aglyn/app-utils/assist-credits'
import { PLAN_PRICING } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  composeStaffOrgAiMargin,
  composeStaffOrgAiOverage,
  composeStaffOrgAiPool,
} from '../usage/staff-org-ai'

/**
 * THE BILLED RATE IS NOT THE PROVIDER COST (AGL-3015).
 *
 * One rate table used to answer two questions — what a customer's credits
 * are charged at, and what the tokens cost us — and every margin, staff cost
 * meter and overage-exposure figure on the platform was therefore computed
 * from a price nobody pays. The catalog now carries both, and this suite
 * exists to keep them apart.
 *
 * Three things go red here, and each is a different way of undoing the split:
 *
 *  1. **Collapsing the two figures.** A catalog with no row where the billed
 *     rate exceeds the provider rate is a catalog where the second field has
 *     become decoration, whatever its declaration still says.
 *  2. **Selling below cost.** A billed rate under its provider rate would
 *     draw fewer credits than the exchange cost, which no surface downstream
 *     could detect — every one of them is denominated in credits.
 *  3. **A reader taking the wrong one.** The readers are named with the
 *     figure each is for and swept for it, because a reader that reverts
 *     goes on returning a plausible number.
 */

const ROOT = join(__dirname, '../../../../../..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

/** One exchange's worth of tokens, with every column non-zero. */
const USAGE = {
  inputTokens: 40_000,
  outputTokens: 4_000,
  cacheReadTokens: 120_000,
  cacheWriteTokens: 20_000,
}

const perMTok = (rates: AiTokenRates) => ({
  input: Math.round(rates.inputPerToken * 1_000_000 * 100) / 100,
  output: Math.round(rates.outputPerToken * 1_000_000 * 100) / 100,
})

describe('the catalog carries two rates, and they have not collapsed', () => {
  it('gives EVERY row both figures', () => {
    for (const entry of AI_MODEL_CATALOG) {
      expect(`${entry.id} provider`).toBe(
        `${entry.id} ${typeof entry.providerRates.inputPerToken === 'number' ? 'provider' : 'missing'}`,
      )
      expect(`${entry.id} billed`).toBe(
        `${entry.id} ${typeof entry.billedRates.inputPerToken === 'number' ? 'billed' : 'missing'}`,
      )
    }
  })

  it('has a row where they DIFFER, or the split is decoration', () => {
    // The guard against a quiet re-merge. If every row were written through
    // `aiRatesAtList`, the two fields would agree everywhere, every reader
    // would look correct, and the next marked-up model would land on a
    // codebase that had forgotten the distinction.
    const marked = AI_MODEL_CATALOG.filter(
      (entry) => entry.billedRates.inputPerToken > entry.providerRates.inputPerToken,
    )
    expect(marked.map((entry) => entry.id)).toEqual(['claude-sonnet-5'])
    const [sonnet] = marked
    // Pinned as list prices, so a change to either half has to be written
    // here in the units the vendor publishes and the plan bands were sized in.
    expect(perMTok(sonnet.providerRates)).toEqual({ input: 2, output: 10 })
    expect(perMTok(sonnet.billedRates)).toEqual({ input: 3, output: 15 })
  })

  it('never bills BELOW what a model costs, on any column', () => {
    // The failure that no surface downstream can see: credits are the only
    // unit a band, a cap, an invoice or a refusal is expressed in, so an
    // exchange that drew fewer credits than it cost would look like ordinary
    // cheap usage everywhere.
    const under: string[] = []
    for (const entry of AI_MODEL_CATALOG) {
      for (const column of [
        'inputPerToken',
        'outputPerToken',
        'cacheReadPerToken',
        'cacheWritePerToken',
      ] as const) {
        if (entry.billedRates[column] < entry.providerRates[column]) {
          under.push(`${entry.id}.${column}`)
        }
      }
    }
    expect(under).toEqual([])
  })

  it('CONTROL: the detector fires on a row billed under its cost', () => {
    // Without this, the assertion above passes for a build whose comparison
    // was inverted or dropped.
    const rigged = { ...aiRatesAtList(3, 15), billedRates: aiRatesAtList(1, 5).billedRates }
    expect(rigged.billedRates.inputPerToken < rigged.providerRates.inputPerToken).toBe(true)
  })

  it('falls back to the dearest tier on BOTH rates for an unknown id', () => {
    expect(aiProviderRatesForModel('not-a-model')).toEqual(AI_FALLBACK_RATES)
    expect(aiBilledRatesForModel('not-a-model')).toEqual(AI_FALLBACK_RATES)
  })

  it('prices a meter sentinel at zero on BOTH rates', () => {
    for (const sentinel of Object.values(AI_METER_SENTINELS)) {
      expect(estimateAiProviderCostUsd(USAGE, sentinel)).toBe(0)
      expect(estimateAiBilledUsd(USAGE, sentinel)).toBe(0)
    }
  })
})

describe('the two estimators answer different questions', () => {
  it('prices the SAME exchange lower at provider rates on a marked-up model', () => {
    const billed = estimateAiBilledUsd(USAGE, 'claude-sonnet-5')
    const cost = estimateAiProviderCostUsd(USAGE, 'claude-sonnet-5')
    expect(billed).toBeGreaterThan(cost)
    // Two thirds, because 2/10 against 3/15 is the same ratio on every
    // column — including the cache columns, which are derived from input.
    expect(cost / billed).toBeCloseTo(2 / 3, 9)
  })

  it('agrees on a model billed at its provider list', () => {
    for (const id of ['claude-haiku-4-5', 'claude-opus-5', 'gpt-5']) {
      expect(`${id}: ${estimateAiProviderCostUsd(USAGE, id)}`).toBe(
        `${id}: ${estimateAiBilledUsd(USAGE, id)}`,
      )
    }
  })

  it('is the CREDIT side that keeps the billed figure', () => {
    // The owner's decision made concrete: a balanced exchange draws about
    // 1.5x the credits its tokens cost us, and that markup is the platform's
    // AI margin rather than an error to be corrected downstream.
    const billed = estimateAiBilledUsd(USAGE, 'claude-sonnet-5')
    const cost = estimateAiProviderCostUsd(USAGE, 'claude-sonnet-5')
    const credits = assistCreditsFromUsd(billed)
    expect(credits).toBe(Math.ceil(billed / ASSIST_CREDIT_COST_USD))
    expect(credits).toBeGreaterThan(assistCreditsFromUsd(cost))
    // …and a credit therefore costs us LESS than the cost-model constant
    // says, never more, which is what makes every margin floor a floor.
    expect(cost / credits).toBeLessThan(ASSIST_CREDIT_COST_USD)
  })
})

describe('a rollup answers the question it was asked', () => {
  it('prefers the provider figure and falls back to the billed one', () => {
    expect(assistProviderCostUsd(3, 2)).toBe(2)
    // A period closed before the split has only the billed figure. Reading
    // it over-states our bill, which is the direction a cost may be wrong in.
    expect(assistProviderCostUsd(3, undefined)).toBe(3)
    expect(assistProviderCostUsd(3, 0)).toBe(3)
    expect(assistProviderCostUsd(3, Number.NaN)).toBe(3)
    expect(assistProviderCostUsd(undefined, undefined)).toBe(0)
  })
})

describe('every reader takes the figure it means', () => {
  /**
   * A source sweep, because the failure this issue fixed is not a wrong
   * number — it is a reader quietly pointed at the other field, which goes
   * on returning something plausible. Each row names a file, the figure it
   * is for, and a fragment that is only present while it reads that figure.
   */
  const READERS: {
    path: string
    means: 'what we pay' | 'what the customer draws'
    fragment: string
    why: string
  }[] = [
    {
      path: 'libs/plugins/ai/src/lib/usage/staff-org-ai.ts',
      means: 'what we pay',
      fragment: `assistProviderCostUsd(\n    billedUsd,\n    monthDoc?.[${'ASSIST_PROVIDER_COST_FIELD'}],\n  )`,
      why: "The staff card's margin section and its spend line: what this workspace cost us.",
    },
    {
      path: 'libs/plugins/ai/src/lib/usage/staff-org-ai.ts',
      means: 'what the customer draws',
      fragment: 'const usedCredits = assistCreditsFromUsd(billedUsd)',
      why: 'Credits drawn against the band on the same card, which bill unchanged.',
    },
    {
      path: 'libs/plugins/ai/src/lib/server/ai-admin-org.ts',
      means: 'what the customer draws',
      fragment: 'composeStaffOrgAiOverage(org as never, pool.billedUsd)',
      why: 'The overage line is an invoice; pricing it off our cost would bill a different month.',
    },
    {
      path: 'libs/plugins/ai/src/lib/server/ai-admin-orgs-spend.ts',
      means: 'what we pay',
      fragment: 'assistProviderCostUsd(',
      why: "The Organizations list's AI spend column, sorted on to find who is spending.",
    },
    {
      path: 'libs/plugins/ai/src/lib/usage/assist-signal-mining.ts',
      means: 'what we pay',
      fragment: 'providerCostUsd: assistProviderCostUsd(',
      why: 'Every dollar mined for the Assist signals page is our bill.',
    },
    {
      path: 'apps/console/app/api/_lib/org-cogs.ts',
      means: 'what we pay',
      fragment: 'assistProviderCostUsd(',
      why: "The discount guardrail's cost of goods.",
    },
    {
      path: 'apps/console/app/api/admin/margin-utilization/route.ts',
      means: 'what we pay',
      fragment: 'assistProviderCostUsd(',
      why: 'The fleet margin page rates organizations on what they cost.',
    },
    {
      path: 'apps/console/app/api/billing/report-usage/route.ts',
      means: 'what we pay',
      fragment: 'const assistCostUsd = assistProviderCostUsd(',
      why: 'The COGS line the discount guardrail reads off the invoice sweep.',
    },
    {
      path: 'apps/console/app/api/billing/report-usage/route.ts',
      means: 'what the customer draws',
      fragment: 'const assistOverage = assistMonthOverage(',
      why: 'The overage credits that actually enter `billedCents`.',
    },
    {
      path: 'libs/plugins/ai/src/lib/providers/anthropic.ts',
      means: 'what the customer draws',
      fragment: 'estimateAiBilledUsd(usage, input.model)',
      why: "A result's `estCostUsd` travels the credit path and nothing else.",
    },
    {
      path: 'libs/plugins/ai/src/lib/providers/model-choice.ts',
      means: 'what the customer draws',
      fragment: 'estimateAiBilledUsd(typical, entry.id)',
      why: 'The model selector quotes credits per request to the workspace picking.',
    },
  ]

  it.each(READERS)('$path — $means: $why', ({ path, fragment }) => {
    expect(`${path}: ${read(path).includes(fragment)}`).toBe(`${path}: true`)
  })

  it('CONTROL: the sweep can fail — a fragment that is not there is reported', () => {
    expect(
      read('libs/plugins/ai/src/lib/usage/staff-org-ai.ts').includes(
        'const usedCredits = assistCreditsFromUsd(providerUsd)',
      ),
    ).toBe(false)
  })

  it('leaves NO reader of the old single-rate API anywhere in the tree', () => {
    // `aiRatesForModel` and `estimateAiCostUsd` were the ambiguous pair. A
    // reintroduced one would compile and would be, by construction, a reader
    // that has not said which figure it means.
    const tracked = execFileSync('git', ['ls-files'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\n')
      .filter((path) => /\.(?:ts|tsx)$/.test(path))
    const offenders = tracked.filter((path) => {
      if (path.endsWith('billed-rate-is-not-provider-cost.spec.ts')) return false
      const text = read(path)
      return /\baiRatesForModel\b|\bestimateAiCostUsd\b/.test(text)
    })
    expect(offenders).toEqual([])
  })
})

describe('the margin the split corrects', () => {
  /**
   * A Pro workspace that drew exactly its band on the balanced tier: 2,750
   * credits, $2.75 of billed spend, $1.833… of provider spend at 2/3 of it.
   */
  const NOW = new Date('2026-09-15T00:00:00.000Z')
  const BILLED_USD = 2.75
  const PROVIDER_USD = Math.round((BILLED_USD * (2 / 3)) * 1_000_000) / 1_000_000
  const ORG = { plan: 'pro' } as never
  const monthDoc = {
    estCostUsd: BILLED_USD,
    [ASSIST_PROVIDER_COST_FIELD]: PROVIDER_USD,
  }

  const marginOf = (doc: Record<string, unknown>) => {
    const pool = composeStaffOrgAiPool(ORG, doc, NOW)
    return composeStaffOrgAiMargin({
      org: ORG,
      pool,
      overage: composeStaffOrgAiOverage(ORG, pool.billedUsd),
      addon: { on: false, priceUsd: null, since: null, sinceSource: 'no-subscription' },
      thresholdUsd: 25,
      multiple: 0,
      contribution: { month: null, marginPct: null, rating: null },
    })
  }

  it('WAS exactly break-even, because both sides were the same figure', () => {
    // The shape of the bug, reproduced: with no provider figure on the
    // document the spend side falls back to what the workspace drew, which
    // is the same arithmetic the plan's assist share is sized by — so a
    // fully-drawn band reads as zero margin whatever the tokens cost.
    const margin = marginOf({ estCostUsd: BILLED_USD })
    expect(margin.spendUsd).toBe(BILLED_USD)
    expect(margin.planAssistShareUsd).toBe(BILLED_USD)
    expect(margin.spendUsd - margin.planAssistShareUsd).toBe(0)
  })

  it('IS a real number once the month carries what it cost us', () => {
    const margin = marginOf(monthDoc)
    // Revenue stays what the customer pays; only the cost side moves.
    expect(margin.planAssistShareUsd).toBe(BILLED_USD)
    expect(margin.spendUsd).toBe(PROVIDER_USD)
    const pct = (margin.planAssistShareUsd - margin.spendUsd) / margin.planAssistShareUsd
    expect(Number((pct * 100).toFixed(1))).toBe(33.3)
    expect(margin.underwater).toBe(false)
  })

  it('still calls a workspace underwater when it really is', () => {
    // The detector has to keep firing, or the correction above is just a
    // margin surface that never goes red.
    const margin = marginOf({
      estCostUsd: 12,
      [ASSIST_PROVIDER_COST_FIELD]: 8,
    })
    expect(margin.spendUsd).toBe(8)
    expect(margin.underwater).toBe(true)
  })

  it('leaves the credits drawn against the band UNCHANGED', () => {
    // The whole constraint on this issue: the split moves cost figures, not
    // what a customer is charged.
    const pool = composeStaffOrgAiPool(ORG, monthDoc, NOW)
    expect(pool.usedCredits).toBe(assistCreditsFromUsd(BILLED_USD))
    expect(pool.usedCredits).toBe(2_750)
    expect(pool.billedUsd).toBe(BILLED_USD)
  })

  it('keeps every retail rate clear of the margin floor, by MORE not less', () => {
    // `assistCreditRateMarginPct` costs a credit at the billed rate, which
    // is at or above what a credit costs us — so the ladder's margins are a
    // lower bound and the split can only widen them. Asserted as the reason
    // the floor stays checkable against one constant.
    const plans = ['pro', 'business', 'scale', 'advanced', 'agency'] as const
    for (const plan of plans) {
      const rate = PLAN_PRICING[plan].extraAssistCreditsUsdPer1k
      const floorMargin = assistCreditRateMarginPct(rate)
      if (floorMargin === null) throw new Error(`${plan} must price an overage`)
      expect(`${plan}: ${floorMargin >= ASSIST_CREDIT_MIN_MARGIN_PCT}`).toBe(`${plan}: true`)
      // The same rate against what a balanced credit actually costs us.
      const realisedCostPer1k = ASSIST_CREDIT_COST_USD * 1000 * (2 / 3)
      const realised = ((rate as number) - realisedCostPer1k) / (rate as number)
      expect(`${plan}: ${realised >= floorMargin}`).toBe(`${plan}: true`)
    }
  })
})
