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
  type PluginFigureRow,
  type PluginFigureTable,
} from '../plugin-manager/plugin-figures'

/**
 * THE WEEKLY SUMMARY (AGL-3867): the free Monday email that says how each of
 * a workspace's sites did last week — visitors, top pages and sources, form
 * submissions, new leads and contacts, bookings, sales, campaigns, funnels,
 * automations — and how the workspace's deals moved.
 *
 * It spends nothing. Every figure is read through the `plugin-figures`
 * registry, so each plugin's own counting rules decide what a figure is, and
 * nothing here is generated. AI weekly insights (AGL-2915) are the paid
 * version that explains the figures, and stay opt-in because each one spends
 * the workspace's AI credits.
 *
 * This module is the words and the arithmetic; the reads and the sends are
 * `@aglyn/tenant-data-admin/server/weekly-summary`.
 */

/** The key a person's switch is stored under in `users/{uid}.digestPrefs`; on until turned off. */
export const WEEKLY_SUMMARY_DIGEST_KEY = 'weeklySummary'

/** The window every figure is read over. */
export const WEEKLY_SUMMARY_DAYS = 7

/** The site readers, in the order the email lists them. */
export const WEEKLY_SUMMARY_SITE_READERS: readonly string[] = [
  'traffic.summary',
  'traffic.pages',
  'traffic.sources',
  'forms.performance',
  'crm.people',
  'bookings.services',
  'commerce.sales',
  'commerce.products',
  'marketing.campaigns',
  'funnels.overview',
  'automations.runs',
]

/** The workspace readers, read once for the whole workspace. */
export const WEEKLY_SUMMARY_ORG_READERS: readonly string[] = ['crm.closed', 'crm.pipeline']

/** Rows a ranked line names: the top pages, the top sources, the busiest forms. */
export const WEEKLY_SUMMARY_TOP_ROWS = 3

/** One table as the summary holds it: the reader it came from, and what it said. */
export interface WeeklySummaryTable {
  reader: string
  table: PluginFigureTable
}

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
    label: `${shortDay(current.from)} – ${shortDay(current.to)}`,
  }
}

/** `2026-10-05` as "Oct 5". */
function shortDay(day: string): string {
  const at = new Date(`${day}T00:00:00Z`)
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

const num = (value: PluginFigureCell | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

function rowWhere(table: PluginFigureTable, key: string, label: string): PluginFigureRow | undefined {
  return table.rows.find((row) => row[key] === label)
}

/** "1,204 (+12%)": a count and, when there is an earlier week to compare with, its change. */
function withChange(table: PluginFigureTable, row: PluginFigureRow, key: string, changeKey: string): string {
  const value = pluginFigureCellText(table, key, row[key] ?? 0)
  const change = row[changeKey]
  if (typeof change !== 'number') return value
  return `${value} (${change === 0 ? 'no change' : pluginFigureCellText(table, changeKey, change)})`
}

/** The named rows with the most of `key`, as "name 12, name 4". */
function ranked(table: PluginFigureTable, nameKey: string, key: string, unit = ''): string | null {
  const rows = table.rows
    .filter((row) => typeof row[nameKey] === 'string' && num(row[key]) > 0)
    .slice(0, WEEKLY_SUMMARY_TOP_ROWS)
  if (!rows.length) return null
  return rows
    .map((row, index) => {
      const amount = pluginFigureCellText(table, key, row[key] ?? 0)
      return `${row[nameKey]} ${amount}${index === 0 && unit ? ` ${unit}` : ''}`
    })
    .join(', ')
}

/** A table nothing below knows the shape of: its first row, labeled. */
function genericLine(table: PluginFigureTable): string | null {
  const row = table.rows[0]
  if (!row) return null
  const counted = table.columns.filter((column) => column.kind !== 'text' && num(row[column.key]) !== 0)
  if (!counted.length) return null
  const label = table.columns.find((column) => column.kind === 'text')
  const name = label && typeof row[label.key] === 'string' ? ` (${row[label.key]})` : ''
  const cells = counted.map((column) => `${column.label} ${pluginFigureCellText(table, column.key, row[column.key])}`)
  return `${table.title}${name}: ${cells.join(' · ')}`
}

/**
 * What one table says in the email, as lines; `[]` when it has nothing to
 * report, which is how a quiet reader drops out of a site's section.
 *
 * Each known reader is worded from its own columns. A reader whose columns
 * are not the ones expected here falls back to its first row, labeled, so a
 * reader that changes shape reads plainly rather than vanishing.
 */
export function weeklySummaryLines({ reader, table }: WeeklySummaryTable): string[] {
  switch (reader) {
    case 'traffic.summary': {
      const visitors = rowWhere(table, 'figure', 'Visitors')
      const views = rowWhere(table, 'figure', 'Page views')
      if (!visitors && !views) break
      if (!num(visitors?.['current']) && !num(views?.['current'])) return []
      const parts = [
        visitors ? `Visitors: ${withChange(table, visitors, 'current', 'change')}` : null,
        views ? `Page views: ${withChange(table, views, 'current', 'change')}` : null,
      ].filter(Boolean)
      return [parts.join(' · ')]
    }
    case 'traffic.pages': {
      if (!table.columns.some((column) => column.key === 'views')) break
      const top = ranked(table, 'page', 'views', 'views')
      return top ? [`Top pages: ${top}`] : []
    }
    case 'traffic.sources': {
      if (!table.columns.some((column) => column.key === 'views')) break
      const top = ranked(table, 'source', 'views', 'views')
      return top ? [`Top sources: ${top}`] : []
    }
    case 'forms.performance': {
      if (!table.columns.some((column) => column.key === 'submissions')) break
      const total = table.rows.reduce((sum, row) => sum + num(row['submissions']), 0)
      if (!total) return []
      // Form figures are kept by calendar month, so the line says so rather
      // than calling a month-to-date count "last week".
      const since = table.period ? ` since ${shortDay(table.period.from)}` : ''
      const top = ranked(table, 'form', 'submissions')
      return [`Form submissions${since}: ${total.toLocaleString('en-US')}${top ? ` (${top})` : ''}`]
    }
    case 'crm.people': {
      const leads = rowWhere(table, 'figure', 'New leads')
      const contacts = rowWhere(table, 'figure', 'New contacts')
      if (!leads && !contacts) break
      const parts = [
        leads && num(leads['current']) ? `New leads: ${withChange(table, leads, 'current', 'change')}` : null,
        contacts && num(contacts['current'])
          ? `New contacts: ${withChange(table, contacts, 'current', 'change')}`
          : null,
      ].filter(Boolean)
      return parts.length ? [parts.join(' · ')] : []
    }
    case 'bookings.services': {
      const all = rowWhere(table, 'service', 'All services')
      if (!all) break
      if (!num(all['booked']) && !num(all['canceled'])) return []
      const canceled = num(all['canceled'])
      const services = ranked(
        { ...table, rows: table.rows.filter((row) => row !== all) },
        'service',
        'booked',
      )
      return [
        `Bookings: ${withChange(table, all, 'booked', 'change')}` +
          (canceled ? `, ${canceled.toLocaleString('en-US')} canceled` : '') +
          (services ? ` (${services})` : ''),
      ]
    }
    case 'commerce.sales': {
      const week = table.rows[0]
      if (!week || !table.columns.some((column) => column.key === 'revenue')) break
      if (!num(week['orders']) && !num(week['revenue'])) return []
      const orders = num(week['orders'])
      return [
        `Sales: ${withChange(table, week, 'revenue', 'revenueChange')} from ` +
          `${orders.toLocaleString('en-US')} order${orders === 1 ? '' : 's'}`,
      ]
    }
    case 'commerce.products': {
      if (!table.columns.some((column) => column.key === 'units')) break
      const top = ranked(table, 'product', 'units', 'sold')
      return top ? [`Top products: ${top}`] : []
    }
    case 'marketing.campaigns': {
      if (!table.columns.some((column) => column.key === 'delivered')) break
      const sent = table.rows.filter((row) => num(row['delivered']) > 0).slice(0, WEEKLY_SUMMARY_TOP_ROWS)
      if (!sent.length) return []
      return [
        'Campaigns: ' +
          sent
            .map(
              (row) =>
                `${row['campaign']} reached ${pluginFigureCellText(table, 'delivered', row['delivered'] ?? 0)}` +
                (typeof row['openRate'] === 'number'
                  ? `, ${pluginFigureCellText(table, 'openRate', row['openRate'])} opened`
                  : ''),
            )
            .join('; '),
      ]
    }
    case 'funnels.overview': {
      if (!table.columns.some((column) => column.key === 'entered')) break
      const busy = table.rows.filter((row) => num(row['entered']) > 0).slice(0, WEEKLY_SUMMARY_TOP_ROWS)
      if (!busy.length) return []
      return [
        'Funnels: ' +
          busy
            .map(
              (row) =>
                `${row['funnel']} ${pluginFigureCellText(table, 'entered', row['entered'] ?? 0)} started, ` +
                `${pluginFigureCellText(table, 'completed', row['completed'] ?? 0)} finished`,
            )
            .join('; '),
      ]
    }
    case 'automations.runs': {
      const all = rowWhere(table, 'automation', 'All automations')
      if (!all) break
      const succeeded = num(all['succeeded'])
      const failed = num(all['failed'])
      if (!succeeded && !failed) return []
      return [
        `Automations: ${succeeded.toLocaleString('en-US')} run${succeeded === 1 ? '' : 's'} finished` +
          (failed ? `, ${failed.toLocaleString('en-US')} failed` : ''),
      ]
    }
    case 'crm.closed': {
      const row = table.rows[0]
      if (!row || !table.columns.some((column) => column.key === 'won')) break
      const won = num(row['won'])
      const lost = num(row['lost'])
      if (!won && !lost) return []
      return [
        `Deals: ${won.toLocaleString('en-US')} won` +
          (won ? ` (${pluginFigureCellText(table, 'wonValue', row['wonValue'] ?? 0)})` : '') +
          `, ${lost.toLocaleString('en-US')} lost`,
      ]
    }
    case 'crm.pipeline': {
      const all = rowWhere(table, 'pipeline', 'All pipelines')
      if (!all) break
      const deals = num(all['deals'])
      if (!deals) return []
      return [
        `Open pipeline: ${deals.toLocaleString('en-US')} deal${deals === 1 ? '' : 's'} worth ` +
          pluginFigureCellText(table, 'value', all['value'] ?? 0),
      ]
    }
    default:
      break
  }
  const line = genericLine(table)
  return line ? [line] : []
}

/** One site's part of the email. */
export interface WeeklySummarySite {
  name: string
  /** The site's dashboard in the console, absolute; `null` with no origin to build it from. */
  url: string | null
  tables: readonly WeeklySummaryTable[]
}

/** The figures a subject line leads with, summed over the sites. */
export function weeklySummaryHeadline(sites: readonly WeeklySummarySite[]): string {
  let visitors = 0
  let leads = 0
  let bookings = 0
  let orders = 0
  for (const site of sites) {
    for (const { reader, table } of site.tables) {
      if (reader === 'traffic.summary') visitors += num(rowWhere(table, 'figure', 'Visitors')?.['current'])
      if (reader === 'crm.people') leads += num(rowWhere(table, 'figure', 'New leads')?.['current'])
      if (reader === 'bookings.services') bookings += num(rowWhere(table, 'service', 'All services')?.['booked'])
      if (reader === 'commerce.sales') orders += num(table.rows[0]?.['orders'])
    }
  }
  const plural = (count: number, one: string, many: string) =>
    `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
  return [
    visitors ? plural(visitors, 'visitor', 'visitors') : null,
    leads ? plural(leads, 'new lead', 'new leads') : null,
    bookings ? plural(bookings, 'booking', 'bookings') : null,
    orders ? plural(orders, 'order', 'orders') : null,
  ]
    .filter(Boolean)
    .slice(0, 3)
    .join(', ')
}

export function composeWeeklySummarySubject(workspaceName: string, sites: readonly WeeklySummarySite[]): string {
  const headline = weeklySummaryHeadline(sites)
  return headline ? `Your week at ${workspaceName}: ${headline}` : `Your week at ${workspaceName}`
}

/** Each site's lines; a site with nothing to report is left out. */
export function weeklySummarySiteSections(
  sites: readonly WeeklySummarySite[],
): Array<{ site: WeeklySummarySite; lines: string[] }> {
  return sites
    .map((site) => ({ site, lines: site.tables.flatMap(weeklySummaryLines) }))
    .filter(({ lines }) => lines.length > 0)
}

export interface WeeklySummaryEmailInput {
  workspaceName: string
  productName: string
  periodLabel: string
  sites: readonly WeeklySummarySite[]
  /** The workspace's own figures: its deals. */
  workspaceTables: readonly WeeklySummaryTable[]
  /** Where AI weekly insights are turned on, when the plan includes them and this person has not; else `null`. */
  aiInsightsUrl: string | null
  settingsUrl: string
  /** Drops the closing "why" line, which the designed email's footer carries. */
  omitClosing?: boolean
}

/**
 * The email's words, or `null` when there is nothing to report at all — a
 * week with no figures is not worth an email, and sending one anyway is how a
 * summary trains people to ignore it.
 */
export function composeWeeklySummaryEmailText(input: WeeklySummaryEmailInput): string | null {
  const sections = weeklySummarySiteSections(input.sites)
  const workspaceLines = input.workspaceTables.flatMap(weeklySummaryLines)
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
    lines.push('', `You get this summary because you manage ${input.workspaceName}. Turn it off in Notifications: ${input.settingsUrl}`)
  }
  return lines.join('\n')
}
