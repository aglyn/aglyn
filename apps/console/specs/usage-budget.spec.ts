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
 * The budget arithmetic, without a cron (AGL-1528).
 *
 * Every case here was forced RED before it was kept — the note on each block
 * says which line was broken to prove it. A guard that cannot fail proves
 * nothing, and this file is the entire idempotency argument for a cron that
 * mails paying customers.
 */

import {
  assistCogsAlertThresholdUsd,
  assistMarginBreach,
  assistMarginMultiple,
  billsAssistTokens,
  budgetAlertDue,
  budgetThresholdCrossed,
  BUDGET_MAX_THRESHOLDS,
  DEFAULT_BUDGET_THRESHOLD_PCTS,
  normalizeBudgetThresholds,
  orgMonthlySpend,
  resolveUsageBudget,
} from '../utils/usage-budget'

describe('resolveUsageBudget', () => {
  it('reads no budget from an org that has never set one', () => {
    expect(resolveUsageBudget({}).budgetSet).toBe(false)
    expect(resolveUsageBudget({}).amountUsd).toBeNull()
    expect(resolveUsageBudget(null).budgetSet).toBe(false)
    expect(resolveUsageBudget(undefined).budgetSet).toBe(false)
  })

  it('reads the amount and rules the customer chose', () => {
    const budget = resolveUsageBudget({
      usageBudget: { amountUsd: 40, thresholdPcts: [25, 100] },
    })
    expect(budget).toEqual({
      budgetSet: true,
      amountUsd: 40,
      thresholdPcts: [25, 100],
    })
  })

  it('gives a budget with no rules the default ladder rather than silence', () => {
    // Forced red by returning `[]` from `normalizeBudgetThresholds` on an
    // empty list: this passed the `budgetSet` assertion and produced a budget
    // that could never alert — coverage on paper, nothing in the mailbox.
    const budget = resolveUsageBudget({ usageBudget: { amountUsd: 40 } })
    expect(budget.thresholdPcts).toEqual([...DEFAULT_BUDGET_THRESHOLD_PCTS])
    expect(budgetThresholdCrossed(40, budget)).toBe(100)
  })

  it('treats a corrupt amount as NO budget, not as an invented one', () => {
    // The deliberate difference from `resolveStorageCap`, which falls back to
    // a low CAP on corruption. A budget refuses nothing, so failing open only
    // costs a warning — while inventing an amount would alert a customer
    // about a number they never typed.
    for (const amountUsd of [0, -5, Number.NaN, 'forty' as never, null as never]) {
      expect(resolveUsageBudget({ usageBudget: { amountUsd } }).budgetSet).toBe(
        false,
      )
    }
  })
})

describe('normalizeBudgetThresholds', () => {
  it('sorts, dedupes and rounds', () => {
    expect(normalizeBudgetThresholds([100, 50, 50, 90.4])).toEqual([50, 90, 100])
  })

  it('drops rules outside the legal band but keeps the rest', () => {
    // 0 and 500 go; 120 stays, because a rule ABOVE the budget is the useful
    // one on a runaway (an org at 3x its budget hears nothing from a ladder
    // that stops at 100).
    expect(normalizeBudgetThresholds([0, 50, 120, 500])).toEqual([50, 120])
  })

  it('falls back to the default ladder rather than to empty', () => {
    // Forced red by `return cleaned` instead of the default: every one of
    // these produced `[]`, i.e. a budget that cannot fire.
    for (const input of [[], null, undefined, 'fifty', [0], [-1, 900], {}]) {
      expect(normalizeBudgetThresholds(input as never)).toEqual([
        ...DEFAULT_BUDGET_THRESHOLD_PCTS,
      ])
    }
  })

  it('bounds how many rules one org can arm', () => {
    const many = normalizeBudgetThresholds([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(many).toHaveLength(BUDGET_MAX_THRESHOLDS)
  })
})

describe('budgetThresholdCrossed', () => {
  const budget = resolveUsageBudget({
    usageBudget: { amountUsd: 100, thresholdPcts: [50, 90, 100] },
  })

  it('is silent below the lowest rule', () => {
    expect(budgetThresholdCrossed(49.99, budget)).toBe(0)
  })

  it('reports the HIGHEST rule crossed, not the lowest', () => {
    // Forced red by returning on the first match: $95 reported 50, so an org
    // that jumped straight past 90 was told it was halfway.
    expect(budgetThresholdCrossed(50, budget)).toBe(50)
    expect(budgetThresholdCrossed(95, budget)).toBe(90)
    expect(budgetThresholdCrossed(100, budget)).toBe(100)
    expect(budgetThresholdCrossed(880, budget)).toBe(100)
  })

  it('never fires without a budget', () => {
    expect(budgetThresholdCrossed(1_000_000, resolveUsageBudget({}))).toBe(0)
  })

  it('never fires on zero or negative spend', () => {
    expect(budgetThresholdCrossed(0, budget)).toBe(0)
    expect(budgetThresholdCrossed(-10, budget)).toBe(0)
    expect(budgetThresholdCrossed(Number.NaN, budget)).toBe(0)
  })
})

describe('budgetAlertDue — the idempotency contract', () => {
  const budget = resolveUsageBudget({
    usageBudget: { amountUsd: 100, thresholdPcts: [50, 90, 100] },
  })
  const month = '2026-08'

  it('alerts the first time a rule is crossed', () => {
    expect(
      budgetAlertDue({ spendUsd: 55, budget, guard: null, month }),
    ).toBe(50)
  })

  it('does NOT re-alert the same rule on the next tick', () => {
    // The whole point. Forced red by dropping the guard comparison: the cron
    // mailed every org over 50% once an hour, forever.
    expect(
      budgetAlertDue({
        spendUsd: 55,
        budget,
        guard: { month, threshold: 50 },
        month,
      }),
    ).toBe(0)
  })

  it('does not re-alert a LOWER rule after a higher one fired', () => {
    // An org that dropped back under 90 (a deleted site, a corrected rollup)
    // must not be told it crossed 50 — it was told something stronger already.
    expect(
      budgetAlertDue({
        spendUsd: 55,
        budget,
        guard: { month, threshold: 100 },
        month,
      }),
    ).toBe(0)
  })

  it('DOES alert when spend climbs to the next rule', () => {
    expect(
      budgetAlertDue({
        spendUsd: 95,
        budget,
        guard: { month, threshold: 50 },
        month,
      }),
    ).toBe(90)
  })

  it('alerts again in a new budget period', () => {
    // Forced red by comparing only the threshold and ignoring `month`: an org
    // that blew its July budget was never warned again in August, September,
    // or ever.
    expect(
      budgetAlertDue({
        spendUsd: 105,
        budget,
        guard: { month: '2026-07', threshold: 100 },
        month,
      }),
    ).toBe(100)
  })

  it('stays silent for an org with no budget, whatever it spends', () => {
    expect(
      budgetAlertDue({
        spendUsd: 9_999,
        budget: resolveUsageBudget({}),
        guard: null,
        month,
      }),
    ).toBe(0)
  })
})

describe('orgMonthlySpend', () => {
  it('reads the invoice’s own cents, in dollars', () => {
    const spend = orgMonthlySpend({
      month: '2026-08',
      rollupBilledCents: 4_237,
      rollupMonth: '2026-08',
      assistEstCostUsd: 0,
    })
    expect(spend.meteredUsd).toBeCloseTo(42.37, 5)
    expect(spend.totalUsd).toBeCloseTo(42.37, 5)
    expect(spend.meteredFresh).toBe(true)
  })

  it('refuses a rollup from a DIFFERENT month', () => {
    // The live hazard, not a hypothetical: `usage-alerts` reads the latest
    // rollup by `computedAt`, which on 1 August is still July's document.
    // Forced red by dropping the month comparison — August's budget was
    // evaluated against July's spend and fired on day one.
    const spend = orgMonthlySpend({
      month: '2026-08',
      rollupBilledCents: 12_000,
      rollupMonth: '2026-07',
      assistEstCostUsd: 0,
    })
    expect(spend.meteredUsd).toBe(0)
    expect(spend.totalUsd).toBe(0)
    // And says WHY it is zero, so a budget that cannot yet be evaluated is
    // distinguishable from one with nothing to report.
    expect(spend.meteredFresh).toBe(false)
  })

  it('reports Assist spend but does NOT bill it by default', () => {
    // Assist is a plan entitlement (`aiAssist: true`) with no per-token price
    // anywhere in the platform. Folding its cost into a customer's "you will
    // owe" figure would be a surprise bill invented by a notification.
    const spend = orgMonthlySpend({
      month: '2026-08',
      rollupBilledCents: 1_000,
      rollupMonth: '2026-08',
      assistEstCostUsd: 6.5,
    })
    expect(spend.assistUsd).toBe(6.5)
    expect(spend.assistBilled).toBe(false)
    expect(spend.totalUsd).toBeCloseTo(10, 5)
  })

  it('counts Assist once the start month names it', () => {
    // The other arm, so the branch is not decoration. Forced red by hard-coding
    // `assistBilled: false` — this case failed and the one above passed, which
    // is what makes the pair a test rather than an assertion.
    const spend = orgMonthlySpend({
      month: '2026-08',
      rollupBilledCents: 1_000,
      rollupMonth: '2026-08',
      assistEstCostUsd: 6.5,
      assistBilledFrom: '2026-08',
    })
    expect(spend.assistBilled).toBe(true)
    expect(spend.totalUsd).toBeCloseTo(16.5, 5)
  })
})

describe('billsAssistTokens', () => {
  it('is off unless a real YYYY-MM names a month at or before this one', () => {
    expect(billsAssistTokens('2026-08', '2026-08')).toBe(true)
    expect(billsAssistTokens('2026-09', '2026-08')).toBe(true)
    expect(billsAssistTokens('2026-07', '2026-08')).toBe(false)
  })

  it('FAILS CLOSED on anything that is not a month', () => {
    // Charging customers because somebody wrote `yes` in a field that wanted a
    // month is the failure this shape exists to make impossible.
    for (const value of ['true', '1', 'yes', '2026-8', '2026-08-01', '', null, undefined]) {
      expect(billsAssistTokens('2026-08', value as never)).toBe(false)
    }
  })
})

describe('the Assist margin guard', () => {
  const month = '2026-08'

  it('takes its threshold from config and falls back to the default', () => {
    expect(assistCogsAlertThresholdUsd('50')).toBe(50)
    for (const bad of ['', '0', '-4', 'lots', null, undefined]) {
      expect(assistCogsAlertThresholdUsd(bad as never)).toBe(25)
    }
  })

  it('stays quiet under the threshold', () => {
    expect(
      assistMarginBreach({ assistUsd: 24.99, thresholdUsd: 25, guard: null, month }),
    ).toBe(false)
  })

  it('fires once at the threshold', () => {
    expect(
      assistMarginBreach({ assistUsd: 25, thresholdUsd: 25, guard: null, month }),
    ).toBe(true)
    expect(
      assistMarginBreach({
        assistUsd: 30,
        thresholdUsd: 25,
        guard: { month, threshold: 1 },
        month,
      }),
    ).toBe(false)
  })

  it('fires AGAIN at the next multiple', () => {
    // Forced red by storing a boolean instead of the multiple: an org whose
    // Assist cost went from $25 to $250 announced itself once, at $25, and
    // then went quiet for the expensive part.
    expect(assistMarginMultiple(52, 25)).toBe(2)
    expect(
      assistMarginBreach({
        assistUsd: 52,
        thresholdUsd: 25,
        guard: { month, threshold: 1 },
        month,
      }),
    ).toBe(true)
  })

  it('resets with the month', () => {
    expect(
      assistMarginBreach({
        assistUsd: 30,
        thresholdUsd: 25,
        guard: { month: '2026-07', threshold: 9 },
        month,
      }),
    ).toBe(true)
  })
})
