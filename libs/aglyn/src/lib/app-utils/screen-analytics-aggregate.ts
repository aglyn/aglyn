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
 * Aggregation for the per-screen traffic table (AGL-1844): folds the AGL-151
 * screen day docs (`hosts/{id}/screenAnalytics/{screenId}:{day}`) a range
 * query returns into one row per screen. Pure — the component owns the reads,
 * this owns the arithmetic, and the spec owns this.
 */

/** The fields this table reads off one screen day doc. */
export interface ScreenDayDocData {
  screenId?: unknown
  total?: unknown
  devices?: Record<string, unknown> | null
  /**
   * Referring host → visits (AGL-2341).
   *
   * /api/analytics/collect increments this on EVERY pageview, keyed per
   * referrer host — the widest-fanout field on the document. It was written
   * for every visitor on every plan and folded into nothing: the only reader
   * was the per-screen drilldown, so the one question a site owner asks first
   * — where is my traffic coming from — could be answered one screen at a
   * time and never across the site.
   *
   * Folded here rather than left out because the sibling `devices` map is
   * aggregated the same way and the silence read as an oversight. It costs
   * nothing at the gate either: this table and the drilldown are behind the
   * SAME `screenAnalytics` Pro+ entitlement, so nothing paid is being given
   * away by summing a field the paid panel already shows.
   */
  referrers?: Record<string, unknown> | null
}

export interface ScreenTrafficRow {
  screenId: string
  total: number
  devices: Record<string, number>
  referrers: Record<string, number>
}

/**
 * One row per screen, pageviews and device splits summed across the range,
 * sorted by views descending. Docs without a usable `screenId` or a positive
 * `total` are dropped — a malformed doc must cost a row, never NaN in a
 * column.
 */
export function aggregateScreenDays(
  docs: readonly ScreenDayDocData[],
): ScreenTrafficRow[] {
  const byScreen = new Map<string, ScreenTrafficRow>()
  for (const data of docs) {
    const screenId = typeof data.screenId === 'string' ? data.screenId : ''
    const total = Number(data.total ?? 0)
    if (!screenId || !Number.isFinite(total) || total <= 0) continue
    let row = byScreen.get(screenId)
    if (!row) {
      row = { screenId, total: 0, devices: {}, referrers: {} }
      byScreen.set(screenId, row)
    }
    row.total += total
    for (const [device, count] of Object.entries(data.devices ?? {})) {
      const n = Number(count ?? 0)
      if (Number.isFinite(n) && n > 0) {
        row.devices[device] = (row.devices[device] ?? 0) + n
      }
    }
    for (const [host, count] of Object.entries(data.referrers ?? {})) {
      const n = Number(count ?? 0)
      if (Number.isFinite(n) && n > 0) {
        row.referrers[host] = (row.referrers[host] ?? 0) + n
      }
    }
  }
  return [...byScreen.values()].sort((a, b) => b.total - a.total)
}

/** The device with the highest count, or empty when none recorded. */
export function topDevice(row: ScreenTrafficRow): string {
  const top = Object.entries(row.devices).sort(([, a], [, b]) => b - a)[0]
  return top?.[0] ?? ''
}

/**
 * The referring host that sent the most visits to this screen, or empty.
 *
 * Empty is the common answer and a true one: a direct visit records no
 * referrer at all, so a screen people reach by typing the address has an
 * empty map rather than a missing one. The column renders that as `--`, the
 * same as `topDevice`, instead of inventing a "direct" bucket the collector
 * never wrote.
 */
export function topReferrer(row: ScreenTrafficRow): string {
  const top = Object.entries(row.referrers).sort(([, a], [, b]) => b - a)[0]
  return top?.[0] ?? ''
}
