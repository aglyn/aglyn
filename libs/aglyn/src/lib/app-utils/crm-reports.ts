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

import type { ContactFacet, ContactSource } from './contacts'
import {
  CONTACT_LIFECYCLE_STAGES,
  CONTACT_LIFECYCLE_STAGE_LABELS,
  CRM_ACTIVITY_KINDS,
  CRM_LEAD_STATUSES,
  type ContactLifecycleStage,
  type CrmActivity,
  type CrmActivityKind,
  type CrmDeal,
  type CrmDealStage,
  type CrmLeadFields,
  type CrmLeadStatus,
  type CrmPipeline,
  type CrmTask,
  crmLeadStatus,
  dealStageById,
  isCrmActivityKind,
  isPipelineArchived,
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
 * Every ACTIVE pipeline is a row even with nothing open — an empty
 * pipeline is a fact about the forecast too — while an archived one is a
 * row only if a deal still sits open in it. A deal in a pipeline the list
 * does not carry at all is grouped under its id with no name, so the
 * total still counts it; its stage cannot be resolved, so it weighs
 * nothing, as everywhere else.
 */
export function forecastByCloseMonth(
  deals: readonly ForecastDeal[],
  pipelines: ReadonlyArray<Pick<CrmPipeline, 'name' | 'stages' | 'archivedAt'> & { $id: string }>,
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
  for (const pipeline of pipelines) {
    if (!isPipelineArchived(pipeline)) pipelineRow(pipeline.$id)
  }

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

/*==========================================
 * ACTIVITY BY TEAMMATE (AGL-2624)
 *=========================================*/

/** One teammate's row of the activity leaderboard. */
export interface ActivityLeaderboardRow {
  /**
   * The account uid, or `''` for work no person did: an activity an
   * automation logged, a task ticked off with nobody assigned. One row
   * rather than a row per automation, because the leaderboard ranks the
   * team, and "nobody" is the honest name for the rest.
   */
  uid: string
  /**
   * The name the newest of this uid's activities was signed with, or `null`
   * when none carried one — a uid that only completed tasks, say. The
   * activity's own `byName` because a scoped reader cannot resolve a
   * colleague's uid any other way; see `CrmActivity.byName`.
   */
  name: string | null
  /** Activities logged, by kind, every kind present even at zero. */
  kinds: Record<CrmActivityKind, number>
  /** Every activity logged, whatever its kind. */
  activities: number
  /** Tasks ticked off. */
  tasksDone: number
}

/** An activity as stored — `kind` is whatever was written, not only what the model names. */
type LeaderboardActivity = Pick<CrmActivity, 'byUid' | 'atMs' | 'byName'> & {
  kind: string
}
type LeaderboardTask = Pick<CrmTask, 'assigneeUid' | 'completedByUid'>

/**
 * Who did what: the activities and the completed tasks of a period,
 * grouped by the person who did them, busiest first.
 *
 * An activity is credited to whoever logged it. A task is credited to
 * whoever COMPLETED it when the route stamped that, and to its assignee
 * otherwise: the leaderboard measures work done, and a manager closing out
 * a departed teammate's list did that work. A kind the model does not
 * name counts as `other` rather than vanishing — the activity happened.
 *
 * Busiest means activities plus tasks; ties break on activities, then on
 * the uid, so two renders of one window draw one order.
 */
export function activityLeaderboard(
  activities: readonly LeaderboardActivity[],
  tasksDone: readonly LeaderboardTask[],
): ActivityLeaderboardRow[] {
  const rows = new Map<string, ActivityLeaderboardRow>()
  /** When each row's name was signed, so a newer signature replaces an older one. */
  const namedAtMs = new Map<string, number>()
  const rowFor = (uid: string) => {
    let row = rows.get(uid)
    if (!row) {
      row = {
        uid,
        name: null,
        kinds: Object.fromEntries(
          CRM_ACTIVITY_KINDS.map((kind) => [kind, 0]),
        ) as Record<CrmActivityKind, number>,
        activities: 0,
        tasksDone: 0,
      }
      rows.set(uid, row)
    }
    return row
  }
  for (const activity of activities) {
    const row = rowFor(String(activity.byUid ?? ''))
    const kind = isCrmActivityKind(activity.kind) ? activity.kind : 'other'
    row.kinds[kind] += 1
    row.activities += 1
    const name = String(activity.byName ?? '').trim()
    const atMs = Number(activity.atMs)
    if (
      name &&
      Number.isFinite(atMs) &&
      atMs > (namedAtMs.get(row.uid) ?? Number.NEGATIVE_INFINITY)
    ) {
      row.name = name
      namedAtMs.set(row.uid, atMs)
    }
  }
  for (const task of tasksDone) {
    rowFor(String(task.completedByUid || task.assigneeUid || '')).tasksDone += 1
  }
  return [...rows.values()].sort(
    (a, b) =>
      b.activities + b.tasksDone - (a.activities + a.tasksDone) ||
      b.activities - a.activities ||
      a.uid.localeCompare(b.uid),
  )
}

/*==========================================
 * LEAD FUNNEL (AGL-2624)
 *=========================================*/

/** The key a lead unqualified with no reason is tallied under. */
export const LEAD_NO_REASON_KEY = '$none'
export const LEAD_NO_REASON_LABEL = 'No reason given'

export interface LeadFunnelReason {
  /** The reason, case-folded and whitespace-collapsed, or {@link LEAD_NO_REASON_KEY}. */
  key: string
  /** The reason as it was first written. */
  label: string
  count: number
}

export interface LeadFunnel {
  /** Every lead handed in. */
  total: number
  /** Leads at each status now, every status present. An absent status is `new`. */
  byStatus: Record<CrmLeadStatus, number>
  /** `new` and `working` — the leads still needing somebody. */
  open: number
  /** Qualified over every lead, 0–1, or `null` when there were none. */
  qualifiedRate: number | null
  /** Unqualified over every lead, 0–1, or `null` when there were none. */
  unqualifiedRate: number | null
  /** Why leads were unqualified, most common first. */
  reasons: LeadFunnelReason[]
}

/**
 * Where a set of leads stands, and why the ones that were closed without
 * converting were closed.
 *
 * A status breakdown rather than a cumulative funnel, because a lead's
 * history is not on the document — only where it is now — and a lead can
 * be qualified straight from `new` without ever having been `working`. A
 * step that claimed "reached working" would be inventing a past. The two
 * rates are over EVERY lead handed in, so a period in which half the leads
 * are still untouched reads as half unconverted, which is what it is.
 *
 * Reasons are free text — the unqualify dialog requires one but does not
 * offer a list — so `Too small` and `too  small` are one reason and the
 * label is whichever spelling came first. An unqualified lead written past
 * the dialog with no reason is counted under its own key rather than
 * dropped: the lead was closed, and "no reason given" is the count a
 * manager wants to see.
 */
export function leadFunnel(
  leads: ReadonlyArray<Pick<CrmLeadFields, 'status' | 'unqualifiedReason'>>,
): LeadFunnel {
  const byStatus = Object.fromEntries(
    CRM_LEAD_STATUSES.map((status) => [status, 0]),
  ) as Record<CrmLeadStatus, number>
  const reasons = new Map<string, LeadFunnelReason>()
  for (const lead of leads) {
    const status = crmLeadStatus(lead)
    byStatus[status] += 1
    if (status !== 'unqualified') continue
    const label = String(lead.unqualifiedReason ?? '').replace(/\s+/g, ' ').trim()
    const key = label ? label.toLowerCase() : LEAD_NO_REASON_KEY
    const row = reasons.get(key) ?? {
      key,
      label: label || LEAD_NO_REASON_LABEL,
      count: 0,
    }
    row.count += 1
    reasons.set(key, row)
  }
  const total = leads.length
  return {
    total,
    byStatus,
    open: byStatus.new + byStatus.working,
    qualifiedRate: total > 0 ? byStatus.qualified / total : null,
    unqualifiedRate: total > 0 ? byStatus.unqualified / total : null,
    reasons: [...reasons.values()].sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label),
    ),
  }
}

/**
 * The leads still needing somebody, from two server counts: every lead,
 * less the ones closed one way or the other.
 *
 * Subtraction rather than a count of the open statuses because a lead
 * nobody has touched carries NO status field — see `crmLeadStatus` — and
 * Firestore cannot select a document by a field's absence. The closed
 * statuses are always written, so they can be counted; what remains is
 * open. Clamped at zero for the moment between the two counts in which a
 * lead was closed.
 */
export function openLeadsFromCounts(total: number, closed: number): number {
  return Math.max(0, Math.round(Number(total) || 0) - Math.round(Number(closed) || 0))
}

/*==========================================
 * CONVERSION BY SOURCE (AGL-2624)
 *=========================================*/

/**
 * The stages that mean a person has bought, or better.
 *
 * `customer` and `evangelist` only. `other` sits after `customer` in the
 * stage list so that no capture can overwrite it, but it names a step the
 * business chose and the report cannot know whether that step is past a
 * purchase; counting it would credit a source with a sale nobody recorded.
 */
const CUSTOMER_STAGES: ReadonlySet<ContactLifecycleStage> = new Set([
  'customer',
  'evangelist',
])

type ConversionFacet = Pick<ContactFacet, 'sources' | 'lifecycleStage' | 'ordersCount'>

/**
 * Whether this holder's view of a person says they have bought: a stage
 * at `customer` or past it, or an order on the books whatever the stage
 * says — an order path that never advanced the stage still sold something.
 */
export function contactIsCustomer(
  facet: Pick<ContactFacet, 'lifecycleStage' | 'ordersCount'>,
): boolean {
  if (facet.lifecycleStage && CUSTOMER_STAGES.has(facet.lifecycleStage)) return true
  const orders = Number(facet.ordersCount ?? 0)
  return Number.isFinite(orders) && orders > 0
}

export interface SourceConversionRow {
  source: ContactSource
  /** People this holder captured through the source. */
  captured: number
  /** Of those, the ones who are customers now. */
  customers: number
  /** `customers / captured`, 0–1. */
  rate: number
}

export interface SourceConversion {
  /** One row per source anybody came through, most captured first. */
  rows: SourceConversionRow[]
  /** People with no source under this holder — no door to credit. */
  unsourced: number
  /** Every counted person who is a customer, once each. */
  customers: number
  /** Every person handed in. */
  total: number
}

/**
 * Which capture surfaces turn into customers.
 *
 * Read through one holder's facet, like every by-source figure: a source
 * is which of THIS business's doors the person came through. A person
 * captured two ways counts under both — the question is "how well does
 * each door convert", and a person who came through two is evidence for
 * both — so the rows can add to more than `total`, and `customers` counts
 * each person once for the tile above the table. Rows rank by captured,
 * not by rate, because a door with one visitor who bought is not the best
 * door.
 */
export function conversionBySource(
  facets: readonly ConversionFacet[],
): SourceConversion {
  const rows = new Map<ContactSource, SourceConversionRow>()
  let unsourced = 0
  let customers = 0
  for (const facet of facets) {
    const isCustomer = contactIsCustomer(facet)
    if (isCustomer) customers += 1
    const sources = (Object.keys(facet.sources ?? {}) as ContactSource[]).filter(
      (source) => facet.sources?.[source],
    )
    if (!sources.length) {
      unsourced += 1
      continue
    }
    for (const source of sources) {
      const row = rows.get(source) ?? { source, captured: 0, customers: 0, rate: 0 }
      row.captured += 1
      if (isCustomer) row.customers += 1
      rows.set(source, row)
    }
  }
  return {
    rows: [...rows.values()]
      .map((row) => ({ ...row, rate: row.customers / row.captured }))
      .sort(
        (a, b) =>
          b.captured - a.captured ||
          b.customers - a.customers ||
          a.source.localeCompare(b.source),
      ),
    unsourced,
    customers,
    total: facets.length,
  }
}
