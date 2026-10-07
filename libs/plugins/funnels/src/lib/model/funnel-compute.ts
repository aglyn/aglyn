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

import { funnelStepMatches, funnelStepTitle } from './funnel-definition'
import type {
  FunnelSourceResult,
  FunnelStep,
  FunnelStepResult,
  JourneyForCompute,
  JourneySource,
} from './funnels.types'

/**
 * A funnel over a set of recorded visits — pure, so every number a result
 * shows is tested here rather than against Firestore.
 *
 * ## How a visit moves through the steps
 *
 * In time order, each step is the FIRST matching recorded step after the
 * previous funnel step was reached. Matching the earliest possible event is
 * what reaches the furthest step a visit could reach at all, so no visit is
 * under-counted by the matcher, and a visit is counted once per step however
 * many times it repeated it. A step done before the step ahead of it in the
 * funnel does not count: order is the point.
 *
 * Time between steps is measured between those same matches, so it is the
 * time from first reaching one step to first reaching the next after it.
 */

/** The most sources a breakdown lists; the rest are folded into "Other". */
export const FUNNEL_SOURCE_ROWS = 8

export const DIRECT_SOURCE = 'Direct'
export const OTHER_SOURCE = 'Other'

/** How far a visit got, and when it reached each step it reached. */
export function journeyProgress(
  steps: readonly FunnelStep[],
  journey: JourneyForCompute,
): { reached: number; times: number[] } {
  const events = [...(journey.steps ?? [])]
    .filter((event) => event && Number.isFinite(event.at))
    .sort((a, b) => a.at - b.at)
  const times: number[] = []
  let index = 0
  for (const event of events) {
    if (index >= steps.length) break
    if (funnelStepMatches(steps[index], event)) {
      times.push(event.at)
      index += 1
    }
  }
  return { reached: index, times }
}

/** The median of a list, or null when it is empty. */
export function median(values: readonly number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

/** The source a visit is credited to in the breakdown. */
export function journeySourceLabel(source: JourneySource | null | undefined): string {
  const utmSource = String(source?.utmSource ?? '').trim()
  if (utmSource) {
    const campaign = String(source?.utmCampaign ?? '').trim()
    return campaign ? `${utmSource} / ${campaign}` : utmSource
  }
  const referrer = String(source?.referrerHost ?? '').trim()
  return referrer || DIRECT_SOURCE
}

const share = (part: number, whole: number): number | null =>
  whole > 0 ? part / whole : null

export interface FunnelComputation {
  steps: FunnelStepResult[]
  entered: number
  completed: number
  overall: number | null
  sources: FunnelSourceResult[]
}

export function computeFunnel(
  steps: readonly FunnelStep[],
  journeys: Iterable<JourneyForCompute>,
): FunnelComputation {
  const counts = steps.map(() => 0)
  const gaps: number[][] = steps.map(() => [])
  const bySource = new Map<string, { entered: number; completed: number }>()

  for (const journey of journeys) {
    const { reached, times } = journeyProgress(steps, journey)
    if (reached === 0) continue
    for (let index = 0; index < reached; index += 1) {
      counts[index] += 1
      if (index > 0) gaps[index].push(Math.max(0, times[index] - times[index - 1]))
    }
    const label = journeySourceLabel(journey.source)
    const row = bySource.get(label) ?? { entered: 0, completed: 0 }
    row.entered += 1
    if (reached === steps.length) row.completed += 1
    bySource.set(label, row)
  }

  const entered = counts[0] ?? 0
  const completed = steps.length ? counts[steps.length - 1] : 0
  const stepRows: FunnelStepResult[] = steps.map((step, index) => ({
    index,
    label: funnelStepTitle(step),
    visitors: counts[index],
    fromPrevious: index === 0 ? null : share(counts[index], counts[index - 1]),
    fromStart: share(counts[index], entered),
    dropOff: index === 0 ? 0 : counts[index - 1] - counts[index],
    medianMsFromPrevious: index === 0 ? null : median(gaps[index]),
  }))

  const ranked = [...bySource.entries()].sort(
    (a, b) => b[1].entered - a[1].entered || a[0].localeCompare(b[0]),
  )
  const sources: FunnelSourceResult[] = ranked
    .slice(0, FUNNEL_SOURCE_ROWS)
    .map(([source, row]) => ({ source, ...row, conversion: share(row.completed, row.entered) }))
  const rest = ranked.slice(FUNNEL_SOURCE_ROWS)
  if (rest.length) {
    const other = rest.reduce(
      (sum, [, row]) => ({
        entered: sum.entered + row.entered,
        completed: sum.completed + row.completed,
      }),
      { entered: 0, completed: 0 },
    )
    sources.push({ source: OTHER_SOURCE, ...other, conversion: share(other.completed, other.entered) })
  }

  return { steps: stepRows, entered, completed, overall: share(completed, entered), sources }
}

const DAY_MS = 24 * 60 * 60 * 1000
const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * A range as the results route reads it: two UTC days, inclusive, no wider
 * than `maxDays` and none of it in the future. Answers the half-open
 * millisecond window to query, or why the range is refused.
 */
export function funnelRange(
  from: unknown,
  to: unknown,
  maxDays: number,
  now: number = Date.now(),
): { from: string; to: string; startMs: number; endMs: number } | { error: string } {
  const fromDay = String(from ?? '')
  const toDay = String(to ?? '')
  if (!DAY.test(fromDay) || !DAY.test(toDay)) return { error: 'Pick a date range.' }
  const startMs = Date.parse(`${fromDay}T00:00:00Z`)
  const endMs = Date.parse(`${toDay}T00:00:00Z`) + DAY_MS
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return { error: 'The range ends before it starts.' }
  }
  if ((endMs - startMs) / DAY_MS > maxDays) {
    return { error: `A range covers at most ${maxDays} days.` }
  }
  if (startMs > now) return { error: 'The range is in the future.' }
  return { from: fromDay, to: toDay, startMs, endMs }
}
