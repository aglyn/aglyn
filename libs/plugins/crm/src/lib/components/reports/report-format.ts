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

import type { CrmReportPeriod } from '@aglyn/aglyn'

/**
 * The label under one week's bar — the day the week starts, as `Sep 1`.
 *
 * The start alone, because a bar is narrow: "Sep 1 – Sep 7" under thirteen
 * bars truncates to nothing readable, and the reader knows every bar is a
 * week because the chart said so.
 */
export function weekLabel(startMs: number): string {
  return new Date(startMs).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

/**
 * The name of a report table's CSV — `crm-activity-30d.csv` — so a folder
 * of downloads says which card and which period each file came from. The
 * cards that describe a stock rather than a flow — the open pipeline, the
 * open tasks — have no period and name none.
 */
export function reportFilename(card: string, period?: CrmReportPeriod): string {
  return `crm-${card}${period ? `-${period}` : ''}.csv`
}

/** A date in a table cell, or a dash for none. */
export function shortDate(ms: number | null | undefined): string {
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0
    ? new Date(ms).toLocaleDateString()
    : '—'
}

/** `1 deal`, `2 deals` — a count with its noun. */
export function plural(count: number, singular: string, many = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : many}`
}
