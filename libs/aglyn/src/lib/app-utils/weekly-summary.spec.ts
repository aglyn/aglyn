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
  composeWeeklySummaryOverviewEmail,
  composeWeeklySummarySiteEmail,
  figureRanked,
  figureStat,
  WEEKLY_SUMMARY_DIGEST_KEY,
  weeklySummaryChange,
  weeklySummaryPeriod,
  weeklySummaryTileRows,
  weeklySummaryTotals,
  type WeeklySummaryColors,
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

const COLORS: WeeklySummaryColors = {
  text: '#212121',
  muted: '#666666',
  border: '#e0e0e0',
  surface: '#fafafa',
  accent: '#00b0ff',
  link: '#0077ad',
  up: '#357a38',
  down: '#9e1e1b',
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

describe('the helpers a reader summarizes its table with', () => {
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
      { name: '/empty', views: 0, change: null },
    ],
  )

  it('makes a tile with its change and the total the overview adds up', () => {
    expect(figureStat(counts, counts.rows[0], 'views', 'Views', { change: 'change', total: { one: 'view', many: 'views' } })).toEqual({
      label: 'Views',
      value: '1,020',
      change: 12.5,
      total: { count: 1_020, one: 'view', many: 'views' },
    })
    expect(figureStat(counts, counts.rows[2], 'views', 'Views', { change: 'change' })).toEqual({ label: 'Views', value: '120' })
  })

  it('ranks the rows with anything to count', () => {
    expect(figureRanked(counts, 'name', 'views')).toEqual([
      { label: '/', value: '1,020' },
      { label: '/pricing', value: '340' },
      { label: '/contact', value: '120' },
    ])
  })

  it('says a change as a rise, a fall, or no change, and nothing without an earlier week', () => {
    expect(weeklySummaryChange(12.5)).toEqual({ text: '+12.5%', sign: 1 })
    expect(weeklySummaryChange(-27.94)).toEqual({ text: '−27.9%', sign: -1 })
    expect(weeklySummaryChange(0)).toEqual({ text: 'no change', sign: 0 })
    expect(weeklySummaryChange(null)).toBeNull()
  })

  it('never leaves a row of tiles with an empty slot beside two', () => {
    expect(weeklySummaryTileRows(1)).toEqual([1])
    expect(weeklySummaryTileRows(2)).toEqual([2])
    expect(weeklySummaryTileRows(3)).toEqual([3])
    expect(weeklySummaryTileRows(4)).toEqual([2, 2])
    expect(weeklySummaryTileRows(5)).toEqual([3, 2])
    expect(weeklySummaryTileRows(6)).toEqual([3, 3])
  })
})

describe('which email lists a reader', () => {
  const reader = (scope: 'site' | 'org', per?: 'site' | 'workspace'): PluginFigureReader => ({
    id: 'acme.widgets',
    label: 'Widgets',
    description: 'Widgets.',
    scope,
    windows: [7],
    read: async () => ({ ok: false, status: 404, error: 'none' }),
    weeklySummary: { ...(per ? { per } : {}), order: 1, summarize: () => null },
  })

  it('follows the reader’s scope unless the reader says otherwise', () => {
    expect(pluginFigureSummarySection(reader('site'))).toBe('site')
    expect(pluginFigureSummarySection(reader('org'))).toBe('workspace')
    expect(pluginFigureSummarySection(reader('org', 'site'))).toBe('site')
    expect(pluginFigureSummarySection({ ...reader('site'), weeklySummary: undefined })).toBeNull()
  })
})

describe('the weekly summary emails', () => {
  const site = (name: string, visitors: number, leads = 0): WeeklySummarySite => ({
    name,
    url: `https://app.example.com/acme/hosts/${name.toLowerCase()}`,
    address: { label: `${name.toLowerCase()}.example.com`, url: `https://${name.toLowerCase()}.example.com` },
    parts: visitors
      ? [
          {
            title: 'Traffic',
            stats: [
              { label: 'Visitors', value: visitors.toLocaleString('en-US'), change: -27.9, total: { count: visitors, one: 'visitor', many: 'visitors' } },
              ...(leads ? [{ label: 'New leads', value: String(leads), total: { count: leads, one: 'new lead', many: 'new leads' } }] : []),
            ],
          },
          { title: 'Where visits came from', rows: [{ label: 'www.google.com', value: '125 views' }] },
        ]
      : [],
  })
  const common: {
    workspaceName: string
    productName: string
    periodLabel: string
    colors: WeeklySummaryColors
    aiInsightsUrl: string | null
    settingsUrl: string
  } = {
    workspaceName: 'Acme',
    productName: 'Aglyn',
    periodLabel: 'Oct 5 – Oct 11',
    colors: COLORS,
    aiInsightsUrl: null,
    settingsUrl: 'https://app.example.com/manage/notifications/settings',
  }

  it('sums each count across sites by its noun, in the order the readers gave them', () => {
    expect(weeklySummaryTotals([site('Shop', 1_204, 2), site('Blog', 96, 1)])).toEqual([
      { count: 1_300, one: 'visitor', many: 'visitors' },
      { count: 3, one: 'new lead', many: 'new leads' },
    ])
  })

  it('draws a site’s email: which site it is, its tiles and lists, in the theme’s colors', () => {
    const email = composeWeeklySummarySiteEmail({ ...common, site: site('Shop', 1_204, 1) })
    expect(email).toMatchObject({
      subject: 'Shop last week: 1,204 visitors, 1 new lead',
      title: 'Shop last week',
      period: 'Oct 5 – Oct 11, compared with the week before',
      buttonLabel: 'Open Shop',
      url: 'https://app.example.com/acme/hosts/shop',
    })
    const html = email?.html ?? ''
    // The site's own address, linked in the email's link color, and whose it is.
    expect(html).toContain('<a href="https://shop.example.com" style="color:#0077ad;')
    expect(html).toContain('shop.example.com</a> · Acme')
    expect(html).toContain('▼ −27.9%')
    expect(html).toContain(COLORS.down)
    // A hostname in a list is kept from being linked by the inbox.
    expect(html).toContain('www.​google.​com')
    expect(email?.text).toContain('Site: shop.example.com (https://shop.example.com) · Acme')
    expect(email?.text).toContain('Visitors: 1,204 (−27.9%)')
    expect(email?.text).toContain('- www.google.com: 125 views')
    expect(email?.text).toContain('Turn it off in Notifications: https://app.example.com/manage/notifications/settings')
  })

  it('carries the workspace’s own figures when it stands in for the overview', () => {
    const email = composeWeeklySummarySiteEmail({
      ...common,
      site: site('Shop', 5),
      workspace: [{ title: 'Deals closed', stats: [{ label: 'Won', value: '2' }] }],
    })
    expect(email?.html).toContain('Acme · Deals closed')
    expect(email?.text).toContain('ACME · DEALS CLOSED')
  })

  it('is not sent for a site with nothing to report', () => {
    expect(composeWeeklySummarySiteEmail({ ...common, site: site('Quiet', 0) })).toBeNull()
  })

  it('draws the overview: totals, a line for each active site, the workspace’s figures, and the quiet ones counted', () => {
    const email = composeWeeklySummaryOverviewEmail({
      ...common,
      sites: [site('Shop', 1_204, 2), site('Blog', 96), site('Quiet', 0)],
      workspace: [{ title: 'Deals closed', stats: [{ label: 'Won', value: '2' }] }],
      url: 'https://app.example.com/acme',
    })
    expect(email?.subject).toBe('Your week at Acme: 1,300 visitors, 2 new leads')
    const html = email?.html ?? ''
    expect(html).toContain('Across 2 sites')
    expect(html).toContain('1,300</div>')
    expect(html).toContain('>Shop</a>')
    expect(html).toContain('shop.example.com</a>')
    expect(html).toContain('1,204 visitors (−27.9%) · 2 new leads')
    expect(html).toContain('1 other site had nothing to report.')
    expect(html).toContain('Deals closed')
    expect(html).toContain("Each site's own summary arrives beside this one.")
    expect(email).toMatchObject({ buttonLabel: 'Open Acme', url: 'https://app.example.com/acme' })
  })

  it('is not sent when nothing anywhere has anything to report', () => {
    expect(composeWeeklySummaryOverviewEmail({ ...common, sites: [site('Quiet', 0)], workspace: [], url: '' })).toBeNull()
  })

  it('offers AI weekly insights only when handed where to turn them on', () => {
    const url = 'https://app.example.com/acme/hosts/shop/analytics'
    expect(composeWeeklySummarySiteEmail({ ...common, site: site('Shop', 10), aiInsightsUrl: url })?.html).toContain(
      `<a href="${url}" style="color:#0077ad;`,
    )
    expect(composeWeeklySummarySiteEmail({ ...common, site: site('Shop', 10) })?.html).not.toContain('AI weekly insights')
  })

  it('keeps its switch under the key the settings page writes', () => {
    expect(NOTIFICATION_DIGESTS[0]).toMatchObject({ pluginId: 'core', key: WEEKLY_SUMMARY_DIGEST_KEY })
  })
})
