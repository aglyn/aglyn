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

import { DEFAULT_DEAL_STAGES } from './crm'
import {
  bucketByWeek,
  closeMonthBuckets,
  crmReportRange,
  currencyOfDeals,
  deltaPercent,
  forecastByCloseMonth,
  funnelFromStages,
  localDayBounds,
  pipelineTotals,
  tally,
  weekBuckets,
} from './crm-reports'

const DAY = 24 * 60 * 60 * 1000

/** A Wednesday mid-afternoon, local time, so month and day arithmetic is unambiguous. */
const NOW = new Date(2026, 8, 16, 15, 30).getTime()

describe('crmReportRange', () => {
  it('measures a day period back from now and the previous period behind it', () => {
    const range = crmReportRange('30d', NOW)
    expect(range.to).toBe(NOW)
    expect(range.from).toBe(NOW - 30 * DAY)
    expect(range.previousTo).toBe(range.from)
    expect(range.previousFrom).toBe(range.from - 30 * DAY)
  })

  it('opens "this month" on the first of the month and compares to the month before', () => {
    const range = crmReportRange('month', NOW)
    expect(range.from).toBe(new Date(2026, 8, 1).getTime())
    expect(range.to).toBe(NOW)
    expect(range.previousFrom).toBe(new Date(2026, 7, 1).getTime())
    expect(range.previousTo).toBe(range.from)
  })
})

describe('weekBuckets', () => {
  it('strides seven days from the start and clips the last bucket at the end', () => {
    const from = NOW - 30 * DAY
    const buckets = weekBuckets(from, NOW)
    expect(buckets).toHaveLength(5)
    expect(buckets[0]).toEqual({ start: from, end: from + 7 * DAY })
    expect(buckets[4]).toEqual({ start: from + 28 * DAY, end: NOW })
  })

  it('is one bucket for a week and none for an empty range', () => {
    expect(weekBuckets(NOW - 7 * DAY, NOW)).toHaveLength(1)
    expect(weekBuckets(NOW, NOW)).toEqual([])
    expect(weekBuckets(NOW + DAY, NOW)).toEqual([])
  })
})

describe('bucketByWeek', () => {
  const from = NOW - 14 * DAY
  const items = [
    { id: 'before', at: from - 1 },
    { id: 'first-day', at: from },
    { id: 'first-week', at: from + 6 * DAY },
    { id: 'second-week', at: from + 7 * DAY },
    { id: 'last-moment', at: NOW - 1 },
    { id: 'now', at: NOW },
    { id: 'undated', at: null },
  ]

  it('places each item in the week its timestamp falls in, [start, end)', () => {
    const buckets = bucketByWeek(items, (item) => item.at, from, NOW)
    expect(buckets.map((bucket) => bucket.items.map((item) => item.id))).toEqual([
      ['first-day', 'first-week'],
      ['second-week', 'last-moment'],
    ])
  })

  it('drops what falls outside the range or carries no time', () => {
    const buckets = bucketByWeek(items, (item) => item.at, from, NOW)
    const placed = buckets.flatMap((bucket) => bucket.items.map((item) => item.id))
    expect(placed).not.toContain('before')
    expect(placed).not.toContain('now')
    expect(placed).not.toContain('undated')
  })

  it('keeps every bucket, empty ones included, so a chart has a bar per week', () => {
    const buckets = bucketByWeek([], () => null, from, NOW)
    expect(buckets).toHaveLength(2)
    expect(buckets.every((bucket) => bucket.items.length === 0)).toBe(true)
  })
})

describe('funnelFromStages', () => {
  it('reads each step as the people who got at least that far', () => {
    const funnel = funnelFromStages({
      subscriber: 10,
      lead: 8,
      'sales-qualified': 4,
      customer: 2,
      other: 3,
    })
    expect(funnel.total).toBe(27)
    expect(funnel.other).toBe(3)
    expect(funnel.steps.map((step) => step.stage)).toEqual([
      'subscriber',
      'lead',
      'marketing-qualified',
      'sales-qualified',
      'opportunity',
      'customer',
      'evangelist',
    ])
    const byStage = Object.fromEntries(funnel.steps.map((step) => [step.stage, step]))
    expect(byStage['subscriber']).toMatchObject({ count: 10, reached: 24, conversion: null })
    expect(byStage['lead']).toMatchObject({ count: 8, reached: 14 })
    expect(byStage['lead'].conversion).toBeCloseTo(14 / 24)
    expect(byStage['marketing-qualified']).toMatchObject({ count: 0, reached: 6 })
    expect(byStage['customer']).toMatchObject({ count: 2, reached: 2 })
    expect(byStage['evangelist']).toMatchObject({ count: 0, reached: 0 })
  })

  it('answers no conversion, not a zero, where nobody reached the step before', () => {
    const funnel = funnelFromStages({ customer: 2 })
    const evangelist = funnel.steps.find((step) => step.stage === 'evangelist')
    expect(evangelist?.reached).toBe(0)
    expect(evangelist?.conversion).toBe(0)
    const lead = funnel.steps.find((step) => step.stage === 'lead')
    // Two people reached "lead" (they are customers), out of two who reached
    // "subscriber": 100%, not undefined.
    expect(lead?.conversion).toBe(1)
    const empty = funnelFromStages({})
    expect(empty.steps.every((step) => step.conversion === null)).toBe(true)
    expect(empty.total).toBe(0)
  })

  it('labels every step and ignores a count that is not a number', () => {
    const funnel = funnelFromStages({ lead: Number.NaN, customer: -1 } as never)
    expect(funnel.steps.every((step) => step.label.length > 0)).toBe(true)
    expect(funnel.total).toBe(0)
  })
})

describe('pipelineTotals', () => {
  const pipeline = { stages: [...DEFAULT_DEAL_STAGES] }
  const deals = [
    { status: 'open' as const, stageId: 'qualified', amountCents: 10_000 },
    { status: 'open' as const, stageId: 'negotiation', amountCents: 50_000 },
    { status: 'open' as const, stageId: 'negotiation', amountCents: 30_000 },
    { status: 'open' as const, stageId: 'retired-stage', amountCents: 7_000 },
    { status: 'won' as const, stageId: 'won', amountCents: 99_000 },
    { status: 'lost' as const, stageId: 'lost', amountCents: 99_000 },
  ]

  it('totals the open deals by open stage, weighted by the stage odds', () => {
    const totals = pipelineTotals(deals, pipeline)
    expect(totals.count).toBe(4)
    expect(totals.amountCents).toBe(97_000)
    // 10% of 10,000 + 60% of 80,000; the deal in a stage the pipeline lost
    // is worth nothing to the forecast, which is `weightedDealAmountCents`'s
    // rule and not a second one.
    expect(totals.weightedCents).toBe(1_000 + 48_000)
    expect(totals.stages.map((row) => row.stage.id)).toEqual([
      'qualified',
      'contact-made',
      'proposal-sent',
      'negotiation',
    ])
    expect(totals.stages[3]).toMatchObject({
      count: 2,
      amountCents: 80_000,
      weightedCents: 48_000,
    })
    expect(totals.stages[1]).toMatchObject({ count: 0, amountCents: 0, weightedCents: 0 })
  })

  it('sets aside an open deal whose stage the pipeline no longer has', () => {
    const totals = pipelineTotals(deals, pipeline)
    expect(totals.unplaced).toEqual({ count: 1, amountCents: 7_000 })
  })

  it('leaves closed deals out: they are history, not pipeline', () => {
    const totals = pipelineTotals(deals, pipeline)
    const placed = totals.stages.reduce((sum, row) => sum + row.count, 0)
    expect(placed + totals.unplaced.count).toBe(4)
  })

  it('is every open deal unplaced when there is no pipeline to read', () => {
    const totals = pipelineTotals(deals, null)
    expect(totals.stages).toEqual([])
    expect(totals.count).toBe(4)
    expect(totals.unplaced).toEqual({ count: 4, amountCents: 97_000 })
    expect(totals.weightedCents).toBe(0)
  })
})

describe('tally', () => {
  it('counts by key, most common first, ties by key', () => {
    const rows = tally(
      ['form', 'order', 'form', 'booking', 'order', 'form', null, undefined, ''],
      (row) => row,
    )
    expect(rows).toEqual([
      { key: 'form', count: 3 },
      { key: 'order', count: 2 },
      { key: 'booking', count: 1 },
    ])
  })
})

describe('deltaPercent', () => {
  it('is the change against the previous period, to one decimal', () => {
    expect(deltaPercent(130, 100)).toBe(30)
    expect(deltaPercent(100, 130)).toBe(-23.1)
    expect(deltaPercent(100, 100)).toBe(0)
  })

  it('is null, not infinity or 100%, when there was nothing before', () => {
    expect(deltaPercent(5, 0)).toBeNull()
    expect(deltaPercent(0, 0)).toBeNull()
  })
})

describe('currencyOfDeals', () => {
  it('names the one currency the deals share, lowercase, usd when none says', () => {
    expect(currencyOfDeals([])).toEqual({ currency: 'usd', mixed: false })
    expect(currencyOfDeals([{ currency: 'EUR' }, { currency: 'eur' }])).toEqual({
      currency: 'eur',
      mixed: false,
    })
    // A deal that names no currency is a dollar deal, per the model — so it
    // agrees with one that says so, and disagrees with a euro one.
    expect(currencyOfDeals([{}, { currency: 'USD' }])).toEqual({
      currency: 'usd',
      mixed: false,
    })
    expect(currencyOfDeals([{}, { currency: 'eur' }]).mixed).toBe(true)
  })

  it('flags a mix and answers the most common', () => {
    expect(
      currencyOfDeals([{ currency: 'gbp' }, { currency: 'usd' }, { currency: 'gbp' }]),
    ).toEqual({ currency: 'gbp', mixed: true })
  })
})

describe('localDayBounds', () => {
  it('spans the local calendar day around the moment', () => {
    const bounds = localDayBounds(NOW)
    expect(bounds.start).toBe(new Date(2026, 8, 16).getTime())
    expect(bounds.end).toBe(new Date(2026, 8, 17).getTime())
  })
})

describe('the forecast by close month (AGL-2620)', () => {
  const sales = { $id: 'sales', name: 'Sales', stages: [...DEFAULT_DEAL_STAGES] }
  const renewals = {
    $id: 'renewals',
    name: 'Renewals',
    stages: DEFAULT_DEAL_STAGES.map((stage) =>
      stage.id === 'qualified' ? { ...stage, probability: 50 } : stage,
    ),
  }
  const local = (year: number, monthIndex: number, day: number) =>
    new Date(year, monthIndex, day, 12).getTime()

  it('buckets the next six local calendar months from the current one, whole', () => {
    const buckets = closeMonthBuckets(NOW)
    expect(buckets.map((bucket) => bucket.key)).toEqual([
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ])
    // The current month starts on its first, not at "now".
    expect(buckets[0].start).toBe(new Date(2026, 8, 1).getTime())
    expect(buckets[0].end).toBe(new Date(2026, 9, 1).getTime())
    expect(buckets[5].end).toBe(new Date(2027, 2, 1).getTime())
  })

  it('lays open deals out per pipeline and month, face value and weighted', () => {
    const forecast = forecastByCloseMonth(
      [
        // September, Sales, 10%: 1,000 → 100.
        { status: 'open', pipelineId: 'sales', stageId: 'qualified', amountCents: 100_000, expectedCloseAtMs: local(2026, 8, 3) },
        // November, Sales, 60%: 500 → 300.
        { status: 'open', pipelineId: 'sales', stageId: 'negotiation', amountCents: 50_000, expectedCloseAtMs: local(2026, 10, 30) },
        // November, Renewals, 50%: 200 → 100.
        { status: 'open', pipelineId: 'renewals', stageId: 'qualified', amountCents: 20_000, expectedCloseAtMs: local(2026, 10, 1) },
        // Undated: its own row, at face value and at its stage odds.
        { status: 'open', pipelineId: 'sales', stageId: 'proposal-sent', amountCents: 10_000, expectedCloseAtMs: null },
        // Overdue (August) and later (March 2027).
        { status: 'open', pipelineId: 'sales', stageId: 'qualified', amountCents: 5_000, expectedCloseAtMs: local(2026, 7, 20) },
        { status: 'open', pipelineId: 'sales', stageId: 'qualified', amountCents: 7_000, expectedCloseAtMs: local(2027, 2, 1) },
        // Closed deals are not a forecast.
        { status: 'won', pipelineId: 'sales', stageId: 'won', amountCents: 900_000, expectedCloseAtMs: local(2026, 8, 10) },
        { status: 'lost', pipelineId: 'sales', stageId: 'lost', amountCents: 900_000, expectedCloseAtMs: local(2026, 8, 10) },
      ],
      [sales, renewals],
      NOW,
    )
    expect(forecast.pipelines.map((row) => row.name)).toEqual(['Sales', 'Renewals'])
    const [salesRow, renewalsRow] = forecast.pipelines
    expect(salesRow.months.map((cell) => cell.amountCents)).toEqual([100_000, 0, 50_000, 0, 0, 0])
    expect(salesRow.months.map((cell) => cell.weightedCents)).toEqual([10_000, 0, 30_000, 0, 0, 0])
    expect(salesRow.undated).toEqual({ count: 1, amountCents: 10_000, weightedCents: 4_000 })
    expect(salesRow.overdue).toEqual({ count: 1, amountCents: 5_000, weightedCents: 500 })
    expect(salesRow.later).toEqual({ count: 1, amountCents: 7_000, weightedCents: 700 })
    expect(salesRow.total).toEqual({ count: 5, amountCents: 172_000, weightedCents: 45_200 })
    expect(renewalsRow.months[2]).toEqual({ count: 1, amountCents: 20_000, weightedCents: 10_000 })
    // The grand rows add the pipelines together.
    expect(forecast.months.map((cell) => cell.amountCents)).toEqual([100_000, 0, 70_000, 0, 0, 0])
    expect(forecast.total).toEqual({ count: 6, amountCents: 192_000, weightedCents: 55_200 })
    expect(forecast.buckets).toHaveLength(6)
  })

  it('keeps an empty pipeline as a row and an unknown one as an unnamed row worth nothing weighted', () => {
    const forecast = forecastByCloseMonth(
      [{ status: 'open', pipelineId: 'gone', stageId: 'qualified', amountCents: 1_000, expectedCloseAtMs: local(2026, 8, 3) }],
      [sales],
      NOW,
    )
    expect(forecast.pipelines.map((row) => [row.pipelineId, row.name])).toEqual([
      ['sales', 'Sales'],
      ['gone', ''],
    ])
    expect(forecast.pipelines[0].total.count).toBe(0)
    expect(forecast.pipelines[1].months[0]).toEqual({ count: 1, amountCents: 1_000, weightedCents: 0 })
    expect(forecast.total.amountCents).toBe(1_000)
  })

  it('gives an archived pipeline a row only while a deal still sits open in it', () => {
    const retired = { $id: 'old', name: 'Sales 2025', stages: [...DEFAULT_DEAL_STAGES], archivedAt: 1_700_000_000_000 }
    const empty = forecastByCloseMonth([], [sales, retired], NOW)
    expect(empty.pipelines.map((row) => row.pipelineId)).toEqual(['sales'])
    const holding = forecastByCloseMonth(
      [{ status: 'open', pipelineId: 'old', stageId: 'qualified', amountCents: 500, expectedCloseAtMs: null }],
      [sales, retired],
      NOW,
    )
    expect(holding.pipelines.map((row) => [row.pipelineId, row.name])).toEqual([
      ['sales', 'Sales'],
      ['old', 'Sales 2025'],
    ])
    expect(holding.pipelines[1].undated).toEqual({ count: 1, amountCents: 500, weightedCents: 50 })
  })

  it('puts a deal dated the first of a month in that month, on the local calendar', () => {
    const forecast = forecastByCloseMonth(
      [
        { status: 'open', pipelineId: 'sales', stageId: 'qualified', amountCents: 100, expectedCloseAtMs: local(2026, 9, 1) },
        { status: 'open', pipelineId: 'sales', stageId: 'qualified', amountCents: 200, expectedCloseAtMs: new Date(2026, 9, 1).getTime() - 1 },
      ],
      [sales],
      NOW,
    )
    expect(forecast.months.map((cell) => cell.amountCents)).toEqual([200, 100, 0, 0, 0, 0])
  })
})
