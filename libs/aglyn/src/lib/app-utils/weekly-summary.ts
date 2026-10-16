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

import {
  pluginFigureCellText,
  pluginFigureIsoWeek,
  pluginFigureWindows,
  type PluginFigureCell,
  type PluginFigureHeadline,
  type PluginFigureRow,
  type PluginFigureTable,
} from '../plugin-manager/plugin-figures'

/**
 * THE WEEKLY SUMMARY (AGL-3867): the free Monday email that says how each of
 * a workspace's sites did last week, and how the workspace's own figures
 * moved.
 *
 * It spends nothing. Every figure comes from a `plugin-figures` reader that
 * declares a `weeklySummary`, and that reader's owner words its own lines, so
 * each plugin's counting rules decide what a figure is and nothing here names
 * one. AI weekly insights (AGL-2915) are the paid version that explains the
 * figures, and stay opt-in because each one spends the workspace's AI credits.
 *
 * This module is the period, the shared wording helpers the readers use, and
 * the email's words; the reads and the sends are
 * `@aglyn/tenant-data-admin/server/weekly-summary`.
 */

/** The key a person's switch is stored under in `users/{uid}.digestPrefs`; on until turned off. */
export const WEEKLY_SUMMARY_DIGEST_KEY = 'weeklySummary'

/** The window every figure is read over. */
export const WEEKLY_SUMMARY_DAYS = 7

/** Rows a ranked line names: the top three. */
export const WEEKLY_SUMMARY_TOP_ROWS = 3

/** Counts the subject line leads with, at most. */
export const WEEKLY_SUMMARY_HEADLINE_COUNTS = 3

/**
 * The week a run reports on: the seven whole UTC days before the day it runs,
 * so a Monday run covers Monday to Sunday and never a part-day of today.
 * `now` is what each reader is handed; `week` keys the run's marker.
 */
export function weeklySummaryPeriod(runAt: Date): {
  now: Date
  week: string
  from: string
  to: string
  label: string
} {
  const startOfToday = Date.UTC(runAt.getUTCFullYear(), runAt.getUTCMonth(), runAt.getUTCDate())
  const now = new Date(startOfToday - 1)
  const { current } = pluginFigureWindows(now, WEEKLY_SUMMARY_DAYS)
  return {
    now,
    week: pluginFigureIsoWeek(now),
    from: current.from,
    to: current.to,
    label: `${weeklySummaryDay(current.from)} – ${weeklySummaryDay(current.to)}`,
  }
}

/** `2026-10-05` as "Oct 5". */
export function weeklySummaryDay(day: string): string {
  const at = new Date(`${day}T00:00:00Z`)
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** A cell as a number, `0` for anything that is not one. */
export function figureCount(value: PluginFigureCell | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** The row whose `key` cell is `label`: "Visitors" in a table of figures. */
export function figureRow(table: PluginFigureTable, key: string, label: string): PluginFigureRow | undefined {
  return table.rows.find((row) => row[key] === label)
}

/** Whether a table carries a column, so a reader that changed shape is noticed rather than misread. */
export function figureHasColumn(table: PluginFigureTable, key: string): boolean {
  return table.columns.some((column) => column.key === key)
}

/** "1,204 (+12%)": a cell and, when there is an earlier week to compare with, its change. */
export function figureWithChange(
  table: PluginFigureTable,
  row: PluginFigureRow,
  key: string,
  changeKey: string,
): string {
  const value = pluginFigureCellText(table, key, row[key] ?? 0)
  const change = row[changeKey]
  if (typeof change !== 'number') return value
  return `${value} (${change === 0 ? 'no change' : pluginFigureCellText(table, changeKey, change)})`
}

/** The named rows with the most of `key`, as "name 12 unit, name 4"; `null` when none has any. */
export function figureRanked(
  table: PluginFigureTable,
  nameKey: string,
  key: string,
  unit = '',
  rows: readonly PluginFigureRow[] = table.rows,
): string | null {
  const top = rows
    .filter((row) => typeof row[nameKey] === 'string' && figureCount(row[key]) > 0)
    .slice(0, WEEKLY_SUMMARY_TOP_ROWS)
  if (!top.length) return null
  return top
    .map((row, index) => {
      const amount = pluginFigureCellText(table, key, row[key] ?? 0)
      return `${row[nameKey]} ${amount}${index === 0 && unit ? ` ${unit}` : ''}`
    })
    .join(', ')
}

/** "1 order", "18 orders". */
export function figurePlural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

/** What one reader said this week: its lines and the count it adds to the subject. */
export interface WeeklySummaryEntry {
  lines: string[]
  headline: PluginFigureHeadline | null
}

/** One site's part of the email. */
export interface WeeklySummarySite {
  name: string
  /** The site's dashboard in the console, absolute; `null` with no origin to build it from. */
  url: string | null
  entries: readonly WeeklySummaryEntry[]
}

/** The subject's counts, summed across sites by their noun, in the order the readers first gave them. */
export function weeklySummaryHeadline(sites: readonly WeeklySummarySite[]): string {
  const sums = new Map<string, PluginFigureHeadline>()
  for (const site of sites) {
    for (const { headline } of site.entries) {
      if (!headline || headline.count <= 0) continue
      const sum = sums.get(headline.one)
      sums.set(headline.one, sum ? { ...sum, count: sum.count + headline.count } : { ...headline })
    }
  }
  return [...sums.values()]
    .slice(0, WEEKLY_SUMMARY_HEADLINE_COUNTS)
    .map(({ count, one, many }) => figurePlural(count, one, many))
    .join(', ')
}

export function composeWeeklySummarySubject(workspaceName: string, sites: readonly WeeklySummarySite[]): string {
  const headline = weeklySummaryHeadline(sites)
  return headline ? `Your week at ${workspaceName}: ${headline}` : `Your week at ${workspaceName}`
}

export interface WeeklySummaryEmailInput {
  workspaceName: string
  productName: string
  periodLabel: string
  sites: readonly WeeklySummarySite[]
  /** The workspace's own figures, such as its deals. */
  workspace: readonly WeeklySummaryEntry[]
  /** Where AI weekly insights are turned on, when the plan includes them and this person has not; else `null`. */
  aiInsightsUrl: string | null
  settingsUrl: string
  /** Drops the closing "why" line, which the designed email's footer carries. */
  omitClosing?: boolean
}

/**
 * The email's words, or `null` when there is nothing to report at all — a
 * week with no figures is not worth an email, and sending one anyway is how a
 * summary trains people to ignore it. A site with nothing to say is left out.
 */
export function composeWeeklySummaryEmailText(input: WeeklySummaryEmailInput): string | null {
  const sections = input.sites
    .map((site) => ({ site, lines: site.entries.flatMap((entry) => entry.lines) }))
    .filter(({ lines }) => lines.length > 0)
  const workspaceLines = input.workspace.flatMap((entry) => entry.lines)
  if (!sections.length && !workspaceLines.length) return null
  const lines: string[] = [
    `Here is how ${input.workspaceName} did last week, ${input.periodLabel}. ` +
      'A change in brackets is against the week before.',
  ]
  for (const { site, lines: siteLines } of sections) {
    lines.push('', site.name, ...siteLines.map((line) => `- ${line}`))
    if (site.url) lines.push(`Open ${site.name} in ${input.productName}: ${site.url}`)
  }
  if (workspaceLines.length) {
    lines.push('', `Across ${input.workspaceName}`, ...workspaceLines.map((line) => `- ${line}`))
  }
  if (input.aiInsightsUrl) {
    lines.push(
      '',
      `Want to know why the numbers moved? AI weekly insights explain each site's figures every Monday. ` +
        `Turn them on from Ask about your numbers on a site's Analytics page: ${input.aiInsightsUrl}`,
    )
  }
  if (!input.omitClosing) {
    lines.push(
      '',
      `You get this summary because you manage ${input.workspaceName}. Turn it off in Notifications: ${input.settingsUrl}`,
    )
  }
  return lines.join('\n')
}
