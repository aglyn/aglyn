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

import type { PluginFigureColumn, PluginFigureRow, PluginFigureTable } from '@aglyn/aglyn/plugin-manager/plugin-figures'
import {
  FORMS_WEEKLY_SUMMARY,
  SOURCES_WEEKLY_SUMMARY,
  TOP_PAGES_WEEKLY_SUMMARY,
  TRAFFIC_WEEKLY_SUMMARY,
} from './ai-figure-summaries'

function table(columns: PluginFigureColumn[], rows: PluginFigureRow[], extra: Partial<PluginFigureTable> = {}): PluginFigureTable {
  return {
    title: 'Figures',
    source: { label: 'Console', path: null },
    period: { from: '2026-10-05', to: '2026-10-11', days: 7 },
    columns,
    rows,
    omitted: 0,
    notes: [],
    ...extra,
  }
}

const SUMMARY: PluginFigureColumn[] = [
  { key: 'figure', label: 'Figure', kind: 'text' },
  { key: 'current', label: 'This window', kind: 'count' },
  { key: 'previous', label: 'Window before', kind: 'count' },
  { key: 'change', label: 'Change', kind: 'change' },
]

describe('traffic and forms in the weekly summary (AGL-3867)', () => {
  it('tiles visitors and page views with their change, and offers visitors to the totals', () => {
    const traffic = table(SUMMARY, [
      { figure: 'Page views', current: 3_410, previous: 3_150, change: 8.3 },
      { figure: 'Visitors', current: 1_204, previous: 1_000, change: 20.4 },
    ])
    expect(TRAFFIC_WEEKLY_SUMMARY.summarize(traffic)).toEqual({
      title: 'Traffic',
      stats: [
        { label: 'Visitors', value: '1,204', change: 20.4, total: { count: 1_204, one: 'visitor', many: 'visitors' } },
        { label: 'Page views', value: '3,410', change: 8.3 },
      ],
    })
    const quiet = table(SUMMARY, [
      { figure: 'Page views', current: 0, previous: 10, change: -100 },
      { figure: 'Visitors', current: 0, previous: 4, change: -100 },
    ])
    expect(TRAFFIC_WEEKLY_SUMMARY.summarize(quiet)).toBeNull()
  })

  it('ranks the top pages and sources', () => {
    const pages = table(
      [
        { key: 'page', label: 'Page', kind: 'text' },
        { key: 'views', label: 'Views', kind: 'count' },
      ],
      [
        { page: '/', views: 1_020 },
        { page: '/pricing', views: 340 },
        { page: '/contact', views: 120 },
        { page: '/about', views: 60 },
      ],
    )
    expect(TOP_PAGES_WEEKLY_SUMMARY.summarize(pages)).toEqual({
      title: 'Top pages',
      rows: [
        { label: '/', value: '1,020 views' },
        { label: '/pricing', value: '340 views' },
        { label: '/contact', value: '120 views' },
        { label: '/about', value: '60 views' },
      ],
    })
    const sources = table(
      [
        { key: 'source', label: 'Source', kind: 'text' },
        { key: 'views', label: 'Views', kind: 'count' },
      ],
      [{ source: 'google.com', views: 610 }],
    )
    expect(SOURCES_WEEKLY_SUMMARY.summarize(sources)).toEqual({
      title: 'Where visits came from',
      rows: [{ label: 'google.com', value: '610 views' }],
    })
    // A table without the column it reads drops out rather than misreporting.
    expect(TOP_PAGES_WEEKLY_SUMMARY.summarize(table([{ key: 'page', label: 'Page', kind: 'text' }], [{ page: '/' }]))).toBeNull()
  })

  it('says form submissions since the month began, because forms are counted by month', () => {
    const forms = table(
      [
        { key: 'form', label: 'Form', kind: 'text' },
        { key: 'submissions', label: 'Submissions', kind: 'count' },
      ],
      [
        { form: 'Contact us', submissions: 10 },
        { form: 'Quote', submissions: 4 },
        { form: 'Unused', submissions: 0 },
      ],
      { period: { from: '2026-10-01', to: '2026-10-11', days: 11 } },
    )
    expect(FORMS_WEEKLY_SUMMARY.summarize(forms)).toEqual({
      title: 'Forms',
      stats: [{ label: 'Submissions since Oct 1', value: '14' }],
      rows: [
        { label: 'Contact us', value: '10' },
        { label: 'Quote', value: '4' },
      ],
    })
  })
})
