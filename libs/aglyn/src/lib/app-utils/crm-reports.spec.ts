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
  activityLeaderboard,
  bucketByWeek,
  contactIsCustomer,
  conversionBySource,
  crmReportRange,
  currencyOfDeals,
  deltaPercent,
  funnelFromStages,
  LEAD_NO_REASON_KEY,
  LEAD_NO_REASON_LABEL,
  leadFunnel,
  localDayBounds,
  openLeadsFromCounts,
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

/**
 * Activity by teammate (AGL-2624): who logged what and who ticked what off,
 * busiest first, with the rest of the work — automations, unassigned tasks
 * — on one honest row.
 */
describe('activityLeaderboard', () => {
  const activities = [
    { kind: 'call', byUid: 'u-ada', byName: 'Ada', atMs: 100 },
    { kind: 'email', byUid: 'u-ada', byName: 'Ada L.', atMs: 300 },
    { kind: 'meeting', byUid: 'u-grace', byName: 'Grace', atMs: 200 },
    { kind: 'note', byUid: 'u-grace', byName: 'Grace', atMs: 250 },
    { kind: 'note', byUid: 'u-grace', atMs: 260 },
    // A kind the model does not name still happened.
    { kind: 'carrier-pigeon', byUid: 'u-grace', byName: 'Grace', atMs: 270 },
    { kind: 'note', byUid: '', atMs: 50, sourceActionId: 'act-1' },
  ] as const

  it('groups activities by who logged them and counts every kind', () => {
    const rows = activityLeaderboard(activities, [])
    const grace = rows.find((row) => row.uid === 'u-grace')
    expect(grace?.kinds).toEqual({ call: 0, email: 0, meeting: 1, note: 2, other: 1 })
    expect(grace?.activities).toBe(4)
    const ada = rows.find((row) => row.uid === 'u-ada')
    expect(ada?.kinds).toEqual({ call: 1, email: 1, meeting: 0, note: 0, other: 0 })
  })

  it('signs each row with the name on the newest activity', () => {
    const rows = activityLeaderboard(activities, [])
    expect(rows.find((row) => row.uid === 'u-ada')?.name).toBe('Ada L.')
    // An unsigned newer activity does not blank a name an older one carried.
    expect(rows.find((row) => row.uid === 'u-grace')?.name).toBe('Grace')
    expect(rows.find((row) => row.uid === '')?.name).toBeNull()
  })

  it('credits a task to whoever completed it, else to its assignee, else to nobody', () => {
    const rows = activityLeaderboard([], [
      { assigneeUid: 'u-ada', completedByUid: 'u-grace' },
      { assigneeUid: 'u-ada' },
      { assigneeUid: 'u-ada', completedByUid: '' },
      {},
    ])
    expect(rows.map((row) => [row.uid, row.tasksDone])).toEqual([
      ['u-ada', 2],
      ['', 1],
      ['u-grace', 1],
    ])
    expect(rows[0].activities).toBe(0)
    expect(rows[0].name).toBeNull()
  })

  it('ranks by activities plus tasks, then activities, then uid', () => {
    const rows = activityLeaderboard(activities, [
      { assigneeUid: 'u-ada' },
      { assigneeUid: 'u-ada' },
      { assigneeUid: 'u-zed' },
      { assigneeUid: 'u-zed' },
      { assigneeUid: 'u-zed' },
      { assigneeUid: 'u-zed' },
    ])
    // Grace 4+0, Ada 2+2 and Zed 0+4 tie at four; Ada logged more.
    expect(rows.map((row) => row.uid)).toEqual(['u-grace', 'u-ada', 'u-zed', ''])
  })

  it('is empty for an empty period', () => {
    expect(activityLeaderboard([], [])).toEqual([])
  })
})

/**
 * The lead funnel (AGL-2624): where a period's leads stand now, and why the
 * closed-without-converting ones were closed.
 */
describe('leadFunnel', () => {
  it('reads an absent status as new and counts every status', () => {
    const funnel = leadFunnel([
      {},
      { status: 'new' },
      { status: 'working' },
      { status: 'qualified' },
      { status: 'qualified' },
      { status: 'unqualified', unqualifiedReason: 'Too small' },
    ])
    expect(funnel.total).toBe(6)
    expect(funnel.byStatus).toEqual({ new: 2, working: 1, qualified: 2, unqualified: 1 })
    expect(funnel.open).toBe(3)
    expect(funnel.qualifiedRate).toBeCloseTo(2 / 6)
    expect(funnel.unqualifiedRate).toBeCloseTo(1 / 6)
  })

  it('has no rate when nothing was captured', () => {
    const funnel = leadFunnel([])
    expect(funnel.total).toBe(0)
    expect(funnel.qualifiedRate).toBeNull()
    expect(funnel.unqualifiedRate).toBeNull()
    expect(funnel.reasons).toEqual([])
  })

  it('folds spellings of one reason together and keeps the first spelling', () => {
    const funnel = leadFunnel([
      { status: 'unqualified', unqualifiedReason: 'Too small' },
      { status: 'unqualified', unqualifiedReason: '  too   SMALL ' },
      { status: 'unqualified', unqualifiedReason: 'Wrong region' },
      { status: 'unqualified' },
      // A reason on a lead that is not unqualified is not a reason.
      { status: 'working', unqualifiedReason: 'Too small' },
    ])
    expect(funnel.reasons).toEqual([
      { key: 'too small', label: 'Too small', count: 2 },
      { key: LEAD_NO_REASON_KEY, label: LEAD_NO_REASON_LABEL, count: 1 },
      { key: 'wrong region', label: 'Wrong region', count: 1 },
    ])
  })
})

describe('openLeadsFromCounts', () => {
  it('is the total less the closed, never below zero', () => {
    expect(openLeadsFromCounts(12, 5)).toBe(7)
    expect(openLeadsFromCounts(3, 5)).toBe(0)
    expect(openLeadsFromCounts(Number.NaN, 2)).toBe(0)
  })
})

/**
 * Conversion by source (AGL-2624): which doors turn into customers, read
 * through one holder's facet.
 */
describe('contactIsCustomer', () => {
  it('is a customer at the customer stage or past it, or with an order on the books', () => {
    expect(contactIsCustomer({ lifecycleStage: 'customer' })).toBe(true)
    expect(contactIsCustomer({ lifecycleStage: 'evangelist' })).toBe(true)
    expect(contactIsCustomer({ lifecycleStage: 'lead', ordersCount: 1 })).toBe(true)
    expect(contactIsCustomer({ ordersCount: 2 })).toBe(true)
  })

  it('is not a customer for an earlier stage, for other, or with no orders', () => {
    expect(contactIsCustomer({ lifecycleStage: 'opportunity' })).toBe(false)
    expect(contactIsCustomer({ lifecycleStage: 'other' })).toBe(false)
    expect(contactIsCustomer({ ordersCount: 0 })).toBe(false)
    expect(contactIsCustomer({})).toBe(false)
  })
})

describe('conversionBySource', () => {
  it('counts a person under every door they came through and a customer once', () => {
    const report = conversionBySource([
      { sources: { form: true, order: true }, lifecycleStage: 'customer' },
      { sources: { form: true }, lifecycleStage: 'lead' },
      { sources: { form: true }, ordersCount: 1 },
      { sources: { booking: true }, lifecycleStage: 'subscriber' },
      { sources: {}, lifecycleStage: 'customer' },
    ])
    expect(report.total).toBe(5)
    expect(report.customers).toBe(3)
    expect(report.unsourced).toBe(1)
    expect(report.rows).toEqual([
      { source: 'form', captured: 3, customers: 2, rate: 2 / 3 },
      { source: 'order', captured: 1, customers: 1, rate: 1 },
      { source: 'booking', captured: 1, customers: 0, rate: 0 },
    ])
  })

  it('ignores a source the facet lists as false', () => {
    const report = conversionBySource([
      { sources: { form: true, member: false as unknown as true } },
    ])
    expect(report.rows.map((row) => row.source)).toEqual(['form'])
  })

  it('is empty with nothing to count', () => {
    expect(conversionBySource([])).toEqual({
      rows: [],
      unsourced: 0,
      customers: 0,
      total: 0,
    })
  })
})
