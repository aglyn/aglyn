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
  figureStat,
  weeklySummaryDay,
} from '@aglyn/aglyn/app-utils/weekly-summary'

/**
 * How the traffic and forms readers read in the weekly summary (AGL-3867).
 * Each answers `null` for a week it has nothing to say about, and for a table
 * that is not the shape it was written for, so a changed reader drops out of
 * the email rather than misreporting.
 */

export const TRAFFIC_WEEKLY_SUMMARY: PluginFigureWeeklySummary = {
  order: 10,
  summarize: (table) => {
    const visitors = figureRow(table, 'figure', 'Visitors')
    const views = figureRow(table, 'figure', 'Page views')
    if (!figureCount(visitors?.['current']) && !figureCount(views?.['current'])) return null
    return {
      title: 'Traffic',
      stats: [
        ...(visitors
          ? [figureStat(table, visitors, 'current', 'Visitors', { change: 'change', total: { one: 'visitor', many: 'visitors' } })]
          : []),
        ...(views ? [figureStat(table, views, 'current', 'Page views', { change: 'change' })] : []),
      ],
    }
  },
}

export const TOP_PAGES_WEEKLY_SUMMARY: PluginFigureWeeklySummary = {
  order: 20,
  summarize: (table) => {
    const rows = figureHasColumn(table, 'views') ? figureRanked(table, 'page', 'views') : []
    return rows.length ? { title: 'Top pages', rows: rows.map((row) => ({ ...row, value: `${row.value} views` })) } : null
  },
}

export const SOURCES_WEEKLY_SUMMARY: PluginFigureWeeklySummary = {
  order: 30,
  summarize: (table) => {
    const rows = figureHasColumn(table, 'views') ? figureRanked(table, 'source', 'views') : []
    return rows.length ? { title: 'Where visits came from', rows: rows.map((row) => ({ ...row, value: `${row.value} views` })) } : null
  },
}

export const FORMS_WEEKLY_SUMMARY: PluginFigureWeeklySummary = {
  order: 40,
  summarize: (table) => {
    if (!figureHasColumn(table, 'submissions')) return null
    const total = table.rows.reduce((sum, row) => sum + figureCount(row['submissions']), 0)
    if (!total) return null
    // Form figures are kept by calendar month, so the block says so rather
    // than calling a month-to-date count "last week".
    const since = table.period ? weeklySummaryDay(table.period.from) : null
    return {
      title: 'Forms',
      stats: [
        {
          label: since ? `Submissions since ${since}` : 'Submissions',
          value: total.toLocaleString('en-US'),
        },
      ],
      rows: figureRanked(table, 'form', 'submissions'),
    }
  },
}
