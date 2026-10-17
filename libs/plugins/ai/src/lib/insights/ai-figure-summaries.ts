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

import type { PluginFigureWeeklySummary } from '@aglyn/aglyn/plugin-manager/plugin-figures'
import {
  figureCount,
  figureHasColumn,
  figureRanked,
  figureRow,
  figureWithChange,
  weeklySummaryDay,
} from '@aglyn/aglyn/app-utils/weekly-summary'

/**
 * How the traffic and forms readers read in the weekly summary (AGL-3867).
 * Each answers `[]` for a week it has nothing to say about, and for a table
 * that is not the shape it was written for, so a changed reader drops out of
 * the email rather than misreporting.
 */

export const TRAFFIC_WEEKLY_SUMMARY: PluginFigureWeeklySummary = {
  order: 10,
  lines: (table) => {
    const visitors = figureRow(table, 'figure', 'Visitors')
    const views = figureRow(table, 'figure', 'Page views')
    if (!figureCount(visitors?.['current']) && !figureCount(views?.['current'])) return []
    return [
      [
        visitors ? `Visitors: ${figureWithChange(table, visitors, 'current', 'change')}` : null,
        views ? `Page views: ${figureWithChange(table, views, 'current', 'change')}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    ]
  },
  headline: (table) => {
    const count = figureCount(figureRow(table, 'figure', 'Visitors')?.['current'])
    return count ? { count, one: 'visitor', many: 'visitors' } : null
  },
}

export const TOP_PAGES_WEEKLY_SUMMARY: PluginFigureWeeklySummary = {
  order: 20,
  lines: (table) => {
    const top = figureHasColumn(table, 'views') ? figureRanked(table, 'page', 'views', 'views') : null
    return top ? [`Top pages: ${top}`] : []
  },
}

export const SOURCES_WEEKLY_SUMMARY: PluginFigureWeeklySummary = {
  order: 30,
  lines: (table) => {
    const top = figureHasColumn(table, 'views') ? figureRanked(table, 'source', 'views', 'views') : null
    return top ? [`Top sources: ${top}`] : []
  },
}

export const FORMS_WEEKLY_SUMMARY: PluginFigureWeeklySummary = {
  order: 40,
  lines: (table) => {
    if (!figureHasColumn(table, 'submissions')) return []
    const total = table.rows.reduce((sum, row) => sum + figureCount(row['submissions']), 0)
    if (!total) return []
    // Form figures are kept by calendar month, so the line says so rather
    // than calling a month-to-date count "last week".
    const since = table.period ? ` since ${weeklySummaryDay(table.period.from)}` : ''
    const top = figureRanked(table, 'form', 'submissions')
    return [`Form submissions${since}: ${total.toLocaleString('en-US')}${top ? ` (${top})` : ''}`]
  },
}
