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

import { NOTIFICATION_DIGESTS } from './notifications'
import {
  pluginFigureSummarySection,
  type PluginFigureColumn,
  type PluginFigureReader,
  type PluginFigureRow,
  type PluginFigureTable,
} from '../plugin-manager/plugin-figures'
import {
  composeWeeklySummaryEmailText,
  composeWeeklySummarySubject,
  figureRanked,
  figureWithChange,
  WEEKLY_SUMMARY_DIGEST_KEY,
  weeklySummaryPeriod,
  type WeeklySummaryEmailInput,
  type WeeklySummaryEntry,
  type WeeklySummarySite,
} from './weekly-summary'

function table(columns: PluginFigureColumn[], rows: PluginFigureRow[]): PluginFigureTable {
  return {
    title: 'Figures',
    source: { label: 'Console', path: null },
    period: { from: '2026-10-05', to: '2026-10-11', days: 7 },
    columns,
    rows,
    omitted: 0,
    notes: [],
  }
}

describe('the weekly summary period (AGL-3867)', () => {
  it('covers the seven whole days before the run, Monday to Sunday', () => {
    expect(weeklySummaryPeriod(new Date('2026-10-12T13:00:00Z'))).toEqual({
      now: new Date('2026-10-11T23:59:59.999Z'),
      week: '2026-W41',
      from: '2026-10-05',
      to: '2026-10-11',
      label: 'Oct 5 – Oct 11',
    })
  })
})

describe('the wording helpers a reader words its lines with', () => {
  const counts = table(
    [
      { key: 'name', label: 'Name', kind: 'text' },
      { key: 'views', label: 'Views', kind: 'count' },
      { key: 'change', label: 'Change', kind: 'change' },
    ],
    [
      { name: '/', views: 1_020, change: 12.5 },
      { name: '/pricing', views: 340, change: 0 },
      { name: '/contact', views: 120, change: null },
      { name: '/about', views: 60, change: null },
      { name: '/empty', views: 0, change: null },
    ],
  )

  it('says a change only when there is an earlier week, and "no change" for none', () => {
    expect(figureWithChange(counts, counts.rows[0], 'views', 'change')).toBe('1,020 (+12.5%)')
    expect(figureWithChange(counts, counts.rows[1], 'views', 'change')).toBe('340 (no change)')
    expect(figureWithChange(counts, counts.rows[2], 'views', 'change')).toBe('120')
  })

  it('ranks the top three with anything to count, naming the unit once', () => {
    expect(figureRanked(counts, 'name', 'views', 'views')).toBe('/ 1,020 views, /pricing 340, /contact 120')
    expect(figureRanked(counts, 'name', 'views', '', counts.rows.slice(4))).toBeNull()
  })
})

describe('which section lists a reader', () => {
  const reader = (scope: 'site' | 'org', per?: 'site' | 'workspace'): PluginFigureReader => ({
    id: 'acme.widgets',
    label: 'Widgets',
    description: 'Widgets.',
    scope,
    windows: [7],
    read: async () => ({ ok: false, status: 404, error: 'none' }),
    weeklySummary: { ...(per ? { per } : {}), order: 1, lines: () => [] },
  })

  it('follows the reader’s scope unless the reader says otherwise', () => {
    expect(pluginFigureSummarySection(reader('site'))).toBe('site')
    expect(pluginFigureSummarySection(reader('org'))).toBe('workspace')
    expect(pluginFigureSummarySection(reader('org', 'site'))).toBe('site')
    expect(pluginFigureSummarySection({ ...reader('site'), weeklySummary: undefined })).toBeNull()
  })
})

describe('the weekly summary email', () => {
  const site = (name: string, visitors: number, extra: string[] = []): WeeklySummarySite => ({
    name,
    url: `https://app.example.com/acme/hosts/${name.toLowerCase()}`,
    entries: [
      {
        lines: visitors ? [`Visitors: ${visitors.toLocaleString('en-US')}`] : [],
        headline: visitors ? { count: visitors, one: 'visitor', many: 'visitors' } : null,
      },
      ...extra.map((line): WeeklySummaryEntry => ({ lines: [line], headline: null })),
    ],
  })
  const input: Omit<WeeklySummaryEmailInput, 'sites'> = {
    workspaceName: 'Acme',
    productName: 'Aglyn',
    periodLabel: 'Oct 5 – Oct 11',
    workspace: [],
    aiInsightsUrl: null,
    settingsUrl: 'https://app.example.com/manage/notifications/settings',
  }

  it('leads the subject with the week’s counts, summed across sites', () => {
    const shop = site('Shop', 1_204)
    const blog = site('Blog', 96)
    const withLeads: WeeklySummarySite = {
      ...blog,
      entries: [...blog.entries, { lines: ['New leads: 1'], headline: { count: 1, one: 'new lead', many: 'new leads' } }],
    }
    expect(composeWeeklySummarySubject('Acme', [shop, withLeads])).toBe('Your week at Acme: 1,300 visitors, 1 new lead')
    expect(composeWeeklySummarySubject('Acme', [])).toBe('Your week at Acme')
  })

  it('lists each site with something to say, with its link, and leaves the rest out', () => {
    const text = composeWeeklySummaryEmailText({ ...input, sites: [site('Shop', 1_204, ['Top pages: / 10']), site('Quiet', 0)] }) ?? ''
    expect(text).toContain('Here is how Acme did last week, Oct 5 – Oct 11.')
    expect(text).toContain('Shop\n- Visitors: 1,204\n- Top pages: / 10\nOpen this site in Aglyn: https://app.example.com/acme/hosts/shop')
    expect(text).not.toContain('Quiet')
    expect(text).toContain('Turn it off in Notifications: https://app.example.com/manage/notifications/settings')
    expect(
      composeWeeklySummaryEmailText({ ...input, sites: [site('Shop', 1_204)], omitClosing: true }),
    ).not.toContain('Turn it off')
  })

  it('lists the workspace’s own figures once, after the sites', () => {
    const text =
      composeWeeklySummaryEmailText({
        ...input,
        sites: [site('Shop', 5)],
        workspace: [{ lines: ['Deals: 2 won'], headline: null }],
      }) ?? ''
    expect(text.indexOf('Across Acme\n- Deals: 2 won')).toBeGreaterThan(text.indexOf('Shop'))
  })

  it('is not sent at all for a week with nothing in it', () => {
    expect(composeWeeklySummaryEmailText({ ...input, sites: [site('Quiet', 0)] })).toBeNull()
  })

  it('offers AI weekly insights only when handed where to turn them on', () => {
    const offered = composeWeeklySummaryEmailText({
      ...input,
      sites: [site('Shop', 10)],
      aiInsightsUrl: 'https://app.example.com/acme/hosts/shop/analytics',
    })
    expect(offered).toContain('AI weekly insights')
    expect(composeWeeklySummaryEmailText({ ...input, sites: [site('Shop', 10)] })).not.toContain('AI weekly insights')
  })

  it('keeps its switch under the key the settings page writes', () => {
    expect(NOTIFICATION_DIGESTS[0]).toMatchObject({ pluginId: 'core', key: WEEKLY_SUMMARY_DIGEST_KEY })
  })
})
