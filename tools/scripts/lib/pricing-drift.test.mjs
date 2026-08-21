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

// Every case here exists to prove the checker can FAIL. A pricing guard that
// cannot go red is worse than none: it converts "nobody checked" into "the
// prices agree", which is the exact sentence someone will rely on before
// taking real money.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parsePlanRecord,
  parseUnitRates,
  indexStripePrices,
  comparePlansToStripe,
  compareFeeLadder,
  compareUnitRateTables,
  publishedMeteredRates,
  overallExitCode,
} from './pricing-drift.mjs'

const TS = `
export const PLAN_PRICING: Record<OrgPlan, PlanPricing> = {
  free: {
    basePriceMonthlyUsd: 0,
    basePriceAnnualMonthlyUsd: 0,
    extraHostMonthlyUsd: null,
    extraSeatMonthlyUsd: null,
    extraCollaboratorMonthlyUsd: null,
    extraDatasetMonthlyUsd: null,
  },
  pro: {
    basePriceMonthlyUsd: 56,
    basePriceAnnualMonthlyUsd: 39,
    extraHostMonthlyUsd: 8,
    extraSeatMonthlyUsd: 4,
    extraCollaboratorMonthlyUsd: 2,
    extraDatasetMonthlyUsd: 2,
  },
}
`

const stripePayload = (over = {}) => ({
  data: [
    { lookup_key: 'aglyn_pro_v2', unit_amount: 5600, active: true, recurring: { interval: 'month' } },
    { lookup_key: 'aglyn_pro_v2_yearly', unit_amount: 46800, active: true, recurring: { interval: 'year' } },
    { lookup_key: 'aglyn_pro_extra_host', unit_amount: 800, active: true, recurring: { interval: 'month' } },
    ...(over.extra ?? []),
  ].map((p) => (over.mutate ? over.mutate(p) : p)),
})

test('parsePlanRecord', async (t) => {
  await t.test('reads numbers and nulls off the literal', () => {
    const parsed = parsePlanRecord(TS, 'PLAN_PRICING')
    assert.equal(parsed.pro.basePriceMonthlyUsd, 56)
    assert.equal(parsed.free.extraHostMonthlyUsd, null)
  })

  await t.test('returns EMPTY when the const is absent, so the caller can exit 2', () => {
    // The failure that matters: a refactor renames the const, the parse finds
    // nothing, and a naive checker reports zero disagreements.
    assert.deepEqual(parsePlanRecord(TS, 'PLAN_PRICING_V3'), {})
  })
})

test('comparePlansToStripe', async (t) => {
  const code = parsePlanRecord(TS, 'PLAN_PRICING')

  await t.test('agrees when Stripe matches, including yearly = monthly x 12', () => {
    const v = comparePlansToStripe(code, indexStripePrices(stripePayload()))
    assert.equal(v.filter((x) => x.status === 'differs').length, 0)
    assert.ok(v.some((x) => x.key === 'aglyn_pro_v2_yearly' && x.status === 'in-sync'))
  })

  await t.test('CATCHES a changed amount', () => {
    const payload = stripePayload({
      mutate: (p) => (p.lookup_key === 'aglyn_pro_v2' ? { ...p, unit_amount: 5900 } : p),
    })
    const v = comparePlansToStripe(code, indexStripePrices(payload))
    const hit = v.find((x) => x.key === 'aglyn_pro_v2')
    assert.equal(hit.status, 'differs')
    assert.match(hit.detail, /code \$56 vs Stripe \$59/)
  })

  await t.test('CATCHES an annual price updated without its monthly twin', () => {
    // $39 x 12 = $468. A "10% rise" applied only to the annual SKU is the
    // drift a human comparing two tables does not see.
    const payload = stripePayload({
      mutate: (p) => (p.lookup_key === 'aglyn_pro_v2_yearly' ? { ...p, unit_amount: 51480 } : p),
    })
    const v = comparePlansToStripe(code, indexStripePrices(payload))
    assert.equal(v.find((x) => x.key === 'aglyn_pro_v2_yearly').status, 'differs')
  })

  await t.test('CATCHES a deactivated price whose amount still agrees', () => {
    const payload = stripePayload({
      mutate: (p) => (p.lookup_key === 'aglyn_pro_v2' ? { ...p, active: false } : p),
    })
    const v = comparePlansToStripe(code, indexStripePrices(payload))
    const hit = v.find((x) => x.key === 'aglyn_pro_v2')
    assert.equal(hit.status, 'differs')
    assert.match(hit.detail, /INACTIVE/)
  })

  await t.test('CATCHES a live price for something the code says is free', () => {
    // The direction that costs money: checkout could charge for a plan the
    // product believes is not purchasable.
    const payload = stripePayload({
      extra: [{ lookup_key: 'aglyn_free_extra_host', unit_amount: 500, active: true, recurring: { interval: 'month' } }],
    })
    const v = comparePlansToStripe(code, indexStripePrices(payload))
    const hit = v.find((x) => x.key === 'aglyn_free_extra_host')
    assert.equal(hit.status, 'differs')
    assert.match(hit.detail, /ACTIVE/)
  })

  await t.test('a MISSING price for a purchasable plan is unreadable, not in-sync', () => {
    const v = comparePlansToStripe(code, indexStripePrices({ data: [] }))
    assert.ok(v.some((x) => x.key === 'aglyn_pro_v2' && x.status === 'unreadable'))
  })

  await t.test('a missing price for free/enterprise is EXPECTED, not a finding', () => {
    const v = comparePlansToStripe(code, indexStripePrices(stripePayload()))
    assert.ok(v.some((x) => x.key === 'aglyn_free_v2' && x.status === 'in-sync'))
  })
})

test('compareFeeLadder catches a moved percentage', () => {
  const ents = {
    pro: { transactionFeeDigitalPct: 3, transactionFeePhysicalPct: 0 },
    starter: { transactionFeeDigitalPct: 4, transactionFeePhysicalPct: 2 },
  }
  const v = compareFeeLadder(ents, {
    pro: { digital: 3, physical: 0 },
    starter: { digital: 5, physical: 2 },
  })
  assert.equal(v.find((x) => x.key === 'fee:pro').status, 'in-sync')
  assert.equal(v.find((x) => x.key === 'fee:starter').status, 'differs')
})

test('compareUnitRateTables catches the two tables diverging', () => {
  const metered = { storagePerGbMonth: 0.026, perPageView: 0.0001, perFormSubmission: 0.00005 }
  const same = compareUnitRateTables(metered, { ...metered, dataStoragePerGbMonth: 0.18 })
  assert.equal(same.filter((v) => v.status === 'differs').length, 0)

  const drifted = compareUnitRateTables(metered, { ...metered, storagePerGbMonth: 0.03 })
  assert.equal(drifted.find((v) => v.key === 'rate:storagePerGbMonth').status, 'differs')
})

test('publishedMeteredRates reproduces the figures on /pricing', () => {
  const p = publishedMeteredRates(
    { storagePerGbMonth: 0.026, perPageView: 0.0001, perFormSubmission: 0.00005 },
    1.3,
  )
  assert.equal(p.storagePerGbMonth, 0.0338)
  assert.equal(p.perThousandPageViews, 0.13)
  assert.equal(p.perThousandFormSubmissions, 0.065)
})

test('parseUnitRates returns null when the table cannot be found', () => {
  assert.equal(parseUnitRates('const NOTHING = 1', 'METERED_UNIT_RATES_USD'), null)
})

test('overallExitCode', async (t) => {
  await t.test('is 1 on any drift — drift beats cannot-check', () => {
    assert.equal(overallExitCode([{ status: 'differs' }, { status: 'unreadable' }]), 1)
  })
  await t.test('is 2 when something is unreadable and nothing differs', () => {
    assert.equal(overallExitCode([{ status: 'in-sync' }, { status: 'unreadable' }]), 2)
  })
  await t.test('is 2 for an EMPTY run rather than calling it drift-free', () => {
    assert.equal(overallExitCode([]), 2)
  })
  await t.test('is 0 only when something compared and nothing differs', () => {
    assert.equal(overallExitCode([{ status: 'in-sync' }]), 0)
  })
})
