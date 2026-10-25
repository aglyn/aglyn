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

/**
 * A referrer key as a person reads it: `google_com` → `google.com`.
 *
 * The collector keys `referrers` by the referring host with every `.` (and
 * the other characters a Firestore field path refuses) written as `_`, so a
 * stored key is never what the visitor's browser showed. Host names carry no
 * `_` of their own in practice, so turning each back into a dot restores the
 * address; an empty key stays empty for the caller's `--`.
 */
export function referrerLabel(key: string): string {
  return key.replace(/_/g, '.')
}

/** One UTC day of one page's traffic, as `hosts/{id}/screenAnalytics/{screenId}:{day}` holds it. */
export interface ScreenTrafficDay {
  total: number
  referrers: Record<string, number>
  devices: Record<string, number>
  /** Summed dwell across the day's samples (AGL-2182). */
  dwellMs: number
  /** How many visits reported a dwell: the divisor. */
  dwellSamples: number
}

/** A referrer and the visits it sent. */
export interface ScreenReferrerCount {
  referrer: string
  count: number
}

/** A page's traffic over its window, as its detail view's "Page traffic" card shows it. */
export interface ScreenTrafficSummary {
  total: number
  /** The mean dwell over the visits that reported one, or null when none did. */
  avgDwellMs: number | null
  /** `desktop 38% · mobile 58% · tablet 4%`; empty when no device was recorded. */
  deviceLine: string
  /** The five referrers that sent the most visits, most first (raw keys: `referrerLabel` names them). */
  topReferrers: ScreenReferrerCount[]
}

/**
 * The figures of a page's "Page traffic" card from its day documents, oldest first (AGL-4011). One function so the
 * console card and the native page detail compute the same numbers, held by the native function cases.
 *
 * The dwell is averaged over SAMPLES, not over views (AGL-2182): not every visit reports one (a killed tab sends
 * nothing), so dividing by views would report less time than any visit spent. The device line names desktop, mobile
 * and tablet in that order, each over every recorded device.
 */
export function summarizeScreenTraffic(days: readonly ScreenTrafficDay[]): ScreenTrafficSummary {
  const total = days.reduce((sum, day) => sum + day.total, 0)
  const dwellTotalMs = days.reduce((sum, day) => sum + day.dwellMs, 0)
  const dwellSamples = days.reduce((sum, day) => sum + day.dwellSamples, 0)
  const referrers: Record<string, number> = {}
  const devices: Record<string, number> = {}
  for (const day of days) {
    for (const [host, count] of Object.entries(day.referrers)) referrers[host] = (referrers[host] ?? 0) + count
    for (const [device, count] of Object.entries(day.devices)) devices[device] = (devices[device] ?? 0) + count
  }
  const deviceSum = Object.values(devices).reduce((sum, count) => sum + count, 0)
  const deviceLine = deviceSum
    ? ['desktop', 'mobile', 'tablet']
        .filter((device) => devices[device])
        .map((device) => `${device} ${Math.round(((devices[device] ?? 0) / deviceSum) * 100)}%`)
        .join(' · ')
    : ''
  return {
    total,
    avgDwellMs: dwellSamples > 0 ? dwellTotalMs / dwellSamples : null,
    deviceLine,
    topReferrers: Object.entries(referrers)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([referrer, count]) => ({ referrer, count })),
  }
}
