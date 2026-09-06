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
 * CRM reporting arithmetic (AGL-2604).
 *
 * The Reports section and the dashboard glance card read Firestore
 * aggregates and bounded windows and then have to turn them into a period, a
 * set of weekly bars, a funnel and a pipeline total. Every one of those is a
 * decision about numbers that a card could get subtly wrong in its own JSX —
 * a bucket boundary that is closed on both ends counts a midnight contact
 * twice, a funnel that divides by the step before reads 100% where nobody
 * arrived, a forecast that weights a closed deal forecasts a sale twice. So
 * they live here, pure and specified, and the cards only draw.
 *
 * Pure data module: no Firestore, no React, no clock — every function that
 * needs "now" is handed it.
 */

import {
  CONTACT_LIFECYCLE_STAGES,
  CONTACT_LIFECYCLE_STAGE_LABELS,
  type ContactLifecycleStage,
  type CrmDeal,
  type CrmDealStage,
  type CrmPipeline,
  dealStageById,
  weightedDealAmountCents,
} from './crm'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

/**
 * The periods a report can be read over.
 *
 * A fixed list rather than a free date range because every period here is
 * also a READ COST: the contact trend runs one count aggregate per week of
 * the period, and the closed-deal chart reads the deals closed within it. A
 * picker that offered "all time" would offer a read nobody has sized.
 */
export const CRM_REPORT_PERIODS = ['7d', '30d', '90d', 'month'] as const

export type CrmReportPeriod = (typeof CRM_REPORT_PERIODS)[number]

export const CRM_REPORT_PERIOD_LABELS: Record<CrmReportPeriod, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  month: 'This month',
}

/**
 * A period and the period before it, as half-open millisecond ranges
 * `[from, to)`.
 *
 * The previous period is what a delta is measured against, so it is always
 * the same LENGTH as the current one and ends exactly where the current one
 * begins: "this month" against "last month", thirty days against the thirty
 * before them. A gap or an overlap between the two would make the comparison
 * a comparison of different things.
 */
export interface CrmReportRange {
  from: number
  to: number
  previousFrom: number
  previousTo: number
}

/**
 * The range a period names at a given moment.
 *
 * `to` is the moment itself, so a period is always "up to now" and a report
 * read twice in one sitting shows the same figures with the newer minutes
 * added. "This month" starts on the first of the LOCAL month, because that
 * is the month the reader sees on their calendar; the day periods count back
 * from the moment rather than from midnight, so "last 7 days" is a full
 * seven days rather than six and a fraction.
 */
export function crmReportRange(
  period: CrmReportPeriod,
  nowMs: number,
): CrmReportRange {
  if (period === 'month') {
    const now = new Date(nowMs)
    const from = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    const previousFrom = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1,
    ).getTime()
    return { from, to: nowMs, previousFrom, previousTo: from }
  }
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
  const from = nowMs - days * DAY_MS
  return {
    from,
    to: nowMs,
    previousFrom: from - days * DAY_MS,
    previousTo: from,
  }
}

/** One week of a period, `[start, end)`; the last week of a period may be short. */
export interface WeekBucketBounds {
  start: number
  end: number
}

/**
 * The weeks a range divides into: seven-day strides from `from`, the last
 * clipped at `to`.
 *
 * Strides from the START of the period rather than calendar weeks, so that
 * "last 7 days" is one bar and "last 30 days" is four full weeks and two
 * days — the period the reader picked, in the reader's units — instead of
 * whatever fragment of a Monday-to-Sunday week the period happened to start
 * inside. An empty or inverted range has no weeks.
 */
export function weekBuckets(from: number, to: number): WeekBucketBounds[] {
  const buckets: WeekBucketBounds[] = []
  if (!(to > from)) return buckets
  for (let start = from; start < to; start += WEEK_MS) {
    buckets.push({ start, end: Math.min(start + WEEK_MS, to) })
  }
  return buckets
}

export interface WeekBucket<T> extends WeekBucketBounds {
  items: T[]
}

/**
 * The items of a range, grouped into its weeks.
 *
 * Half-open on every boundary, so an item at exactly midnight between two
 * weeks is in the later one and only the later one, and an item at `to` is
 * outside the period the way an item at `from` is inside it. Items with no
 * usable time are dropped rather than placed anywhere — an undated deal is
 * not a deal closed this week. Every week is returned, empty ones included,
 * because a chart wants a bar per week and a gap where a week had nothing is
 * a chart with the wrong number of bars.
 */
export function bucketByWeek<T>(
  items: readonly T[],
  atMs: (item: T) => number | null | undefined,
  from: number,
  to: number,
): WeekBucket<T>[] {
  const buckets: WeekBucket<T>[] = weekBuckets(from, to).map((bounds) => ({
    ...bounds,
    items: [] as T[],
  }))
  if (!buckets.length) return buckets
  for (const item of items) {
    const at = atMs(item)
    if (typeof at !== 'number' || !Number.isFinite(at)) continue
    if (at < from || at >= to) continue
    const index = Math.min(
      buckets.length - 1,
      Math.floor((at - from) / WEEK_MS),
    )
    buckets[index].items.push(item)
  }
  return buckets
}

/** One step of the lifecycle funnel. */
export interface LifecycleFunnelStep {
  stage: ContactLifecycleStage
  label: string
  /** People AT this stage. */
  count: number
  /** People at this stage or any later one — everyone who got at least this far. */
  reached: number
  /**
   * `reached` over the previous step's `reached`, 0–1, or `null` on the first
   * step and wherever nobody reached the step before.
   */
  conversion: number | null
}

export interface LifecycleFunnel {
  /** The progression, in `CONTACT_LIFECYCLE_STAGES` order, `other` left out. */
  steps: LifecycleFunnelStep[]
  /** People at the `other` stage, which is beside the funnel rather than in it. */
  other: number
  /** Every counted person, `other` included. */
  total: number
}

/**
 * The lifecycle funnel a set of per-stage counts describes.
 *
 * A funnel is read CUMULATIVELY: a customer was once a lead, so the "lead"
 * step is everyone who is a lead now or has moved past it, not only the
 * people currently sitting there. That is what makes the steps narrow as
 * they go down and what makes a step-to-step conversion mean something.
 * `other` is a stage a merchant chose for a person the funnel does not
 * describe, so it is reported beside the funnel and never folded into a
 * step. A conversion where the previous step was empty is `null` rather than
 * 0 or 100 — there is nothing to divide by, and either number would be read
 * as a measurement.
 */
export function funnelFromStages(
  counts: Partial<Record<ContactLifecycleStage, number>>,
): LifecycleFunnel {
  const countOf = (stage: ContactLifecycleStage): number => {
    const value = Number(counts[stage] ?? 0)
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
  }
  const progression = CONTACT_LIFECYCLE_STAGES.filter(
    (stage) => stage !== 'other',
  )
  const steps: LifecycleFunnelStep[] = []
  let reachedAfter = 0
  for (let index = progression.length - 1; index >= 0; index -= 1) {
    const stage = progression[index]
    const count = countOf(stage)
    const reached = count + reachedAfter
    steps.unshift({
      stage,
      label: CONTACT_LIFECYCLE_STAGE_LABELS[stage],
      count,
      reached,
      conversion: null,
    })
    reachedAfter = reached
  }
  for (let index = 1; index < steps.length; index += 1) {
    const previous = steps[index - 1].reached
    steps[index].conversion = previous > 0 ? steps[index].reached / previous : null
  }
  const other = countOf('other')
  return {
    steps,
    other,
    total: steps.reduce((sum, step) => sum + step.count, 0) + other,
  }
}

/** The open deals sitting in one stage of a pipeline. */
export interface PipelineStageTotal {
  stage: CrmDealStage
  count: number
  amountCents: number
  weightedCents: number
}

export interface PipelineTotals {
  /** Open deals, wherever they sit. */
  count: number
  amountCents: number
  /** The forecast: each open deal at its stage's odds. */
  weightedCents: number
  /** The pipeline's open stages in order, every one present even when empty. */
  stages: PipelineStageTotal[]
  /**
   * Open deals in a stage the pipeline does not have — retired, renamed, or
   * a closed-kind stage the status disagrees with. Counted in the totals,
   * worth nothing to the forecast, and reported so a merchant can find them.
   */
  unplaced: { count: number; amountCents: number }
}

type PipelineDeal = Pick<CrmDeal, 'status' | 'stageId' | 'amountCents'>

/**
 * What a pipeline holds, by stage.
 *
 * Only OPEN deals: a won deal is revenue and a lost one is history, and a
 * pipeline report that counted either would show a stage full of deals that
 * cannot move. Only the pipeline's open-kind stages are rows, for the same
 * reason from the other side — a "Won" column in a pipeline chart is the
 * closed-deals report drawn in the wrong place. The weighting is
 * `weightedDealAmountCents`, applied here rather than restated.
 */
export function pipelineTotals(
  deals: readonly PipelineDeal[],
  pipeline: Pick<CrmPipeline, 'stages'> | null | undefined,
): PipelineTotals {
  const stages = [...(pipeline?.stages ?? [])]
    .filter((stage) => stage.kind === 'open')
    .sort((a, b) => a.order - b.order)
  const rows = new Map<string, PipelineStageTotal>(
    stages.map((stage) => [
      stage.id,
      { stage, count: 0, amountCents: 0, weightedCents: 0 },
    ]),
  )
  const totals: PipelineTotals = {
    count: 0,
    amountCents: 0,
    weightedCents: 0,
    stages: stages.map((stage) => rows.get(stage.id) as PipelineStageTotal),
    unplaced: { count: 0, amountCents: 0 },
  }
  for (const deal of deals) {
    if (deal.status !== 'open') continue
    const amount = Math.max(0, Math.round(Number(deal.amountCents ?? 0) || 0))
    totals.count += 1
    totals.amountCents += amount
    const row = rows.get(deal.stageId)
    if (!row) {
      totals.unplaced.count += 1
      totals.unplaced.amountCents += amount
      continue
    }
    const weighted = weightedDealAmountCents(deal, row.stage)
    row.count += 1
    row.amountCents += amount
    row.weightedCents += weighted
    totals.weightedCents += weighted
  }
  return totals
}

/** How many months ahead the close-month forecast looks. */
export const FORECAST_MONTHS = 6

/** One calendar month of the forecast, `[start, end)` in local time. */
export interface CloseMonthBucket {
  /** `2026-09` — stable across locales, what a row is keyed by. */
  key: string
  start: number
  end: number
}

/**
 * The next `months` calendar months from the one `nowMs` falls in, each
 * `[first of the month, first of the next)` on the reader's calendar.
 *
 * The current month is the first bucket, whole: a deal expected to close
 * on the 3rd when today is the 20th is late, not next month's, and a
 * forecast that started at "now" would drop it between the rows. Local
 * months rather than UTC, because `expectedCloseAtMs` is stored at local
 * noon of the day picked (`dateInputMs`) and a UTC boundary would put a
 * deal picked for the 1st into the month before in half the world.
 */
export function closeMonthBuckets(
  nowMs: number,
  months = FORECAST_MONTHS,
): CloseMonthBucket[] {
  const now = new Date(nowMs)
  const buckets: CloseMonthBucket[] = []
  for (let offset = 0; offset < months; offset += 1) {
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1)
    buckets.push({
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
      start: start.getTime(),
      end: end.getTime(),
    })
  }
  return buckets
}

/** One pipeline's open deals expected to close in one month. */
export interface ForecastCell {
  count: number
  amountCents: number
  weightedCents: number
}

export interface PipelineForecast {
  pipelineId: string
  name: string
  /** One cell per bucket, in `buckets` order, every one present even when empty. */
  months: ForecastCell[]
  /** Open deals with no expected close — their own row, never a guess. */
  undated: ForecastCell
  /** Expected before the first bucket — overdue to close. */
  overdue: ForecastCell
  /** Expected past the last bucket. */
  later: ForecastCell
  total: ForecastCell
}

export interface CloseMonthForecast {
  buckets: CloseMonthBucket[]
  pipelines: PipelineForecast[]
  /** Every pipeline's cells added together, in `buckets` order. */
  months: ForecastCell[]
  undated: ForecastCell
  overdue: ForecastCell
  later: ForecastCell
  total: ForecastCell
}

type ForecastDeal = Pick<
  CrmDeal,
  'status' | 'pipelineId' | 'stageId' | 'amountCents' | 'expectedCloseAtMs'
>

const emptyCell = (): ForecastCell => ({ count: 0, amountCents: 0, weightedCents: 0 })

function addToCell(cell: ForecastCell, amountCents: number, weightedCents: number) {
  cell.count += 1
  cell.amountCents += amountCents
  cell.weightedCents += weightedCents
}

/**
 * The open pipeline laid out by the month each deal is expected to close
 * (AGL-2620): per pipeline, one cell per month for the next
 * {@link FORECAST_MONTHS}, at face value and weighted by the deal's stage.
 *
 * Only open deals, for the reason `pipelineTotals` gives — a closed deal
 * has closed. A deal with no `expectedCloseAtMs` is its own row rather than
 * being dropped or dated "now": a forecast that quietly omitted undated
 * deals would understate the pipeline by exactly the deals nobody has
 * scheduled, which is the number a sales lead most wants to see. A deal
 * dated before the first month is overdue and a deal dated past the last
 * is "later"; both are reported so the rows add up to the pipeline.
 *
 * A deal in a pipeline the list does not carry (archived, or a pipeline
 * the reader cannot see) is grouped under its id with no name, so the
 * total still counts it; its stage cannot be resolved, so it weighs
 * nothing, as everywhere else.
 */
export function forecastByCloseMonth(
  deals: readonly ForecastDeal[],
  pipelines: ReadonlyArray<Pick<CrmPipeline, 'name' | 'stages'> & { $id: string }>,
  nowMs: number,
  months = FORECAST_MONTHS,
): CloseMonthForecast {
  const buckets = closeMonthBuckets(nowMs, months)
  const byId = new Map<string, PipelineForecast>()
  const pipelineRow = (pipelineId: string): PipelineForecast => {
    let row = byId.get(pipelineId)
    if (!row) {
      const pipeline = pipelines.find((entry) => entry.$id === pipelineId)
      row = {
        pipelineId,
        name: pipeline?.name ?? '',
        months: buckets.map(emptyCell),
        undated: emptyCell(),
        overdue: emptyCell(),
        later: emptyCell(),
        total: emptyCell(),
      }
      byId.set(pipelineId, row)
    }
    return row
  }
  // Every visible pipeline gets a row, in the order given, even with no
  // open deals: an empty pipeline is a fact about the forecast too.
  for (const pipeline of pipelines) pipelineRow(pipeline.$id)

  const totals: CloseMonthForecast = {
    buckets,
    pipelines: [],
    months: buckets.map(emptyCell),
    undated: emptyCell(),
    overdue: emptyCell(),
    later: emptyCell(),
    total: emptyCell(),
  }
  const first = buckets[0]?.start ?? nowMs
  const last = buckets[buckets.length - 1]?.end ?? nowMs
  for (const deal of deals) {
    if (deal.status !== 'open') continue
    const pipelineId = String(deal.pipelineId ?? '')
    const row = pipelineRow(pipelineId)
    const pipeline = pipelines.find((entry) => entry.$id === pipelineId)
    const amount = Math.max(0, Math.round(Number(deal.amountCents ?? 0) || 0))
    const weighted = weightedDealAmountCents(deal, dealStageById(pipeline, deal.stageId))
    const at = deal.expectedCloseAtMs
    const cells: Array<[ForecastCell, ForecastCell]> = [[row.total, totals.total]]
    if (typeof at !== 'number' || !Number.isFinite(at)) {
      cells.push([row.undated, totals.undated])
    } else if (at < first) {
      cells.push([row.overdue, totals.overdue])
    } else if (at >= last) {
      cells.push([row.later, totals.later])
    } else {
      const index = buckets.findIndex((bucket) => at >= bucket.start && at < bucket.end)
      cells.push([row.months[index], totals.months[index]])
    }
    for (const [own, all] of cells) {
      addToCell(own, amount, weighted)
      addToCell(all, amount, weighted)
    }
  }
  totals.pipelines = [...byId.values()]
  return totals
}

/**
 * How many of a list share each key, most common first.
 *
 * Ties break on the key so two renders of the same data draw the same order.
 * An item with no key is not "a key called empty": a contact whose facet
 * names no source is left out of a by-source chart rather than drawn as a
 * bar labeled with nothing.
 */
export function tally<T>(
  items: readonly T[],
  keyOf: (item: T) => string | null | undefined,
): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>()
  for (const item of items) {
    const key = keyOf(item)
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

/**
 * Percentage change against the previous period, to one decimal, or `null`
 * when the previous period had nothing.
 *
 * `null` rather than a number because every number is wrong: "+100%" reads
 * as growth, "+0%" reads as flat, and a first contact has no growth rate.
 * The tile that renders this draws nothing for `null`, which is the honest
 * rendering of "there is no baseline".
 */
export function deltaPercent(current: number, previous: number): number | null {
  if (!(previous > 0)) return null
  return Math.round(((current - previous) / previous) * 1000) / 10
}

/**
 * The currency a set of deals is in, and whether they are actually in more
 * than one.
 *
 * A pipeline total is a sum, and a sum of dollars and euros is a number
 * with no unit. The reports still show that number — a merchant with one
 * stray euro deal wants the pipeline figure, not a refusal — but they say
 * it is mixed. The most common currency names the total; `usd` is what a
 * deal with no currency means, per the model.
 */
export function currencyOfDeals(
  deals: ReadonlyArray<Pick<CrmDeal, 'currency'>>,
): { currency: string; mixed: boolean } {
  const ranked = tally(deals, (deal) =>
    String(deal.currency || 'usd').toLowerCase(),
  )
  return { currency: ranked[0]?.key ?? 'usd', mixed: ranked.length > 1 }
}

/**
 * The local calendar day a moment falls in, `[start, end)`.
 *
 * The same day `taskDueState` decides "today" on, so a count of tasks due
 * today and the list's "today" chip agree about the same task at 11 p.m.
 */
export function localDayBounds(nowMs: number): { start: number; end: number } {
  const now = new Date(nowMs)
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return { start: start.getTime(), end: end.getTime() }
}
