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
 * The arithmetic behind the traffic tiles `/product/analytics` advertises
 * (AGL-2160).
 *
 * Its mockup shows four tiles — `Page views 48,210 / +12% vs prior`,
 * `Mobile / Desktop 61% / 39%`, `Top page`, `Top referrer`. The card had
 * `Pageviews`, a separate `Week over week` tile pinned to 7-vs-7 whatever
 * the range selector said, and a one-word `Top device`.
 */

/** One day counter document, as the traffic card reads it. */
export interface TrafficDay {
  day: string
  total: number
  visitors: number
  paths: Record<string, number>
  referrers: Record<string, number>
  devices: Record<string, number>
}

export interface TrafficWindows<T> {
  /** The newest `windowSize` days, oldest first — what the chart plots. */
  current: T[]
  /** The `windowSize` days before those, for the comparison only. */
  prior: T[]
}

/**
 * Splits a `windowSize * 2` run of days into the displayed window and the
 * one behind it.
 *
 * Both callers pass days OLDEST FIRST, which is the order the chart reads
 * and the order the fetch produces. Getting this backwards is silent — the
 * delta simply comes out negated — so the split is here with a test rather
 * than inline in a 400-line component.
 */
export function splitTrafficWindows<T>(
  days: readonly T[],
  windowSize: number,
): TrafficWindows<T> {
  if (windowSize <= 0) return { current: [], prior: [] }
  const current = days.slice(-windowSize)
  const prior = days.slice(-windowSize * 2, -windowSize)
  return { current, prior }
}

/**
 * Percentage change between two window totals, to one decimal.
 *
 * `null` when the prior window recorded nothing. A site's first week has no
 * growth rate, and `+100%` — or `+∞`, or `+0%` — all say something the data
 * does not. The tile renders nothing instead.
 */
export function trafficDeltaPct(
  current: number,
  prior: number,
): number | null {
  if (!prior) return null
  return Math.round(((current - prior) / prior) * 1000) / 10
}

export interface DeviceSplitEntry {
  device: string
  count: number
  /** Whole percent of the window's device-classified views. */
  percent: number
}

/**
 * The device split as the mockup shows it: `Mobile / Desktop`, `61% / 39%`.
 *
 * Ordered by share, and NOT padded with zero-count devices — a site with no
 * tablet traffic should not carry a `Tablet 0%` label, which reads as a
 * measurement rather than an absence.
 *
 * Percentages are rounded independently and therefore need not total 100.
 * That is deliberate: forcing the largest share to absorb the rounding
 * error makes one number wrong to make a sum right, and nothing here sums
 * them.
 */
export function deviceSplit(
  devices: Record<string, number>,
): DeviceSplitEntry[] {
  const entries = Object.entries(devices ?? {}).filter(
    ([, count]) => Number.isFinite(count) && count > 0,
  )
  const sum = entries.reduce((total, [, count]) => total + count, 0)
  if (!sum) return []
  return entries
    .sort(([, a], [, b]) => b - a)
    .map(([device, count]) => ({
      device,
      count,
      percent: Math.round((count / sum) * 100),
    }))
}

/** `Mobile / Desktop` — the labels, title-cased, for the tile's caption. */
export function deviceSplitLabel(split: readonly DeviceSplitEntry[]): string {
  return split
    .map((entry) => entry.device.charAt(0).toUpperCase() + entry.device.slice(1))
    .join(' / ')
}

/** `61% / 39%` — the figures, in the same order as the labels. */
export function deviceSplitValue(split: readonly DeviceSplitEntry[]): string {
  return split.map((entry) => `${entry.percent}%`).join(' / ')
}

/**
 * Sums a per-day map across a window, returning entries by descending
 * count. Shared by paths and referrers, which had two copies of it.
 */
export function rollUp(
  days: readonly Partial<
    Record<'paths' | 'referrers', Record<string, number>>
  >[],
  field: 'paths' | 'referrers',
): [string, number][] {
  const totals: Record<string, number> = {}
  for (const day of days) {
    const map = day[field] ?? {}
    for (const [key, count] of Object.entries(map)) {
      totals[key] = (totals[key] ?? 0) + count
    }
  }
  return Object.entries(totals).sort(([, a], [, b]) => b - a)
}

/**
 * `2m 04s` — the dwell format `/product/analytics`'s per-screen mockup
 * shows (AGL-2182).
 *
 * Seconds are zero-padded so a column of these stays aligned, and the
 * minute part is dropped below a minute rather than rendering `0m 04s`,
 * which reads like a broken clock.
 */
export function formatDwell(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
}
