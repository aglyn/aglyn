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
  it('says visitors and page views with their change, and leads the subject with visitors', () => {
    const traffic = table(SUMMARY, [
      { figure: 'Page views', current: 3_410, previous: 3_150, change: 8.3 },
      { figure: 'Visitors', current: 1_204, previous: 1_000, change: 20.4 },
    ])
    expect(TRAFFIC_WEEKLY_SUMMARY.lines(traffic)).toEqual(['Visitors: 1,204 (+20.4%) · Page views: 3,410 (+8.3%)'])
    expect(TRAFFIC_WEEKLY_SUMMARY.headline?.(traffic)).toEqual({ count: 1_204, one: 'visitor', many: 'visitors' })
    const quiet = table(SUMMARY, [
      { figure: 'Page views', current: 0, previous: 10, change: -100 },
      { figure: 'Visitors', current: 0, previous: 4, change: -100 },
    ])
    expect(TRAFFIC_WEEKLY_SUMMARY.lines(quiet)).toEqual([])
    expect(TRAFFIC_WEEKLY_SUMMARY.headline?.(quiet)).toBeNull()
  })

  it('names the top pages and sources', () => {
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
    expect(TOP_PAGES_WEEKLY_SUMMARY.lines(pages)).toEqual(['Top pages: / 1,020 views, /pricing 340, /contact 120'])
    const sources = table(
      [
        { key: 'source', label: 'Source', kind: 'text' },
        { key: 'views', label: 'Views', kind: 'count' },
      ],
      [{ source: 'google.com', views: 610 }],
    )
    expect(SOURCES_WEEKLY_SUMMARY.lines(sources)).toEqual(['Top sources: google.com 610 views'])
    expect(TOP_PAGES_WEEKLY_SUMMARY.lines(table([{ key: 'page', label: 'Page', kind: 'text' }], [{ page: '/' }]))).toEqual([])
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
    expect(FORMS_WEEKLY_SUMMARY.lines(forms)).toEqual(['Form submissions since Oct 1: 14 (Contact us 10, Quote 4)'])
  })
})
