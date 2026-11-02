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
  figureBars,
  figureRanked,
  figureStat,
  WEEKLY_SUMMARY_DIGEST_KEY,
  weeklySummaryChange,
  weeklySummaryPeriod,
  weeklySummaryFootnoteHtml,
  weeklySummaryLeadHtml,
  weeklySummaryNoteHtml,
  weeklySummaryPlainDates,
  weeklySummaryRowLink,
  weeklySummarySectionsHtml,
  weeklySummaryTileRows,
  weeklySummaryTilesHtml,
  weeklySummaryTotals,
  weeklySummaryWeekday,
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
      { label: '/', value: '1,020', change: 12.5 },
      { label: '/pricing', value: '340', change: 0 },
      { label: '/contact', value: '120' },
    ])
  })

  it('draws a table of days as a chart, oldest first, the busiest marked', () => {
    const days = table(
      [
        { key: 'day', label: 'Day', kind: 'date' },
        { key: 'views', label: 'Page views', kind: 'count' },
      ],
      [
        { day: '2026-10-26', views: 161 },
        { day: '2026-10-27', views: 78 },
      ],
    )
    expect(figureBars(days, 'day', 'views')).toEqual([
      { label: 'Mon, Oct 26', value: 161, display: '161', marked: true },
      { label: 'Tue, Oct 27', value: 78, display: '78', marked: false },
    ])
  })

  it('draws no chart of a week with nothing in it', () => {
    const quiet = table(
      [
        { key: 'day', label: 'Day', kind: 'date' },
        { key: 'views', label: 'Page views', kind: 'count' },
      ],
      [{ day: '2026-10-26', views: 0 }],
    )
    expect(figureBars(quiet, 'day', 'views')).toEqual([])
  })

  it('links a row that names a page to the page, and the home page as Home', () => {
    expect(weeklySummaryRowLink('/pricing', 'https://acme.com')).toEqual({ label: '/pricing', url: 'https://acme.com/pricing' })
    expect(weeklySummaryRowLink('/', 'https://acme.com')).toEqual({ label: 'Home', url: 'https://acme.com' })
    expect(weeklySummaryRowLink('/pricing', null)).toEqual({ label: '/pricing', url: null })
    expect(weeklySummaryRowLink('Contact', 'https://acme.com')).toEqual({ label: 'Contact', url: null })
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

  it('draws each topic as a section: its report link, pages linked with their change, and the week as a chart', () => {
    const email = composeWeeklySummarySiteEmail({
      ...common,
      site: {
        ...site('Shop', 1_204),
        parts: [
          {
            title: 'Top pages',
            link: { label: 'Analytics', url: 'https://app.example.com/acme/hosts/shop/analytics' },
            rows: [{ label: '/pricing', value: '95 views', change: 86.3 }],
          },
          { title: 'Traffic by day', bars: [{ label: 'Mon, Oct 26', value: 161, display: '161', marked: true }] },
        ],
      },
    })
    expect(email?.html).toContain('href="https://shop.example.com/pricing"')
    expect(email?.html).toContain('+86.3%')
    expect(email?.html).toContain('href="https://app.example.com/acme/hosts/shop/analytics"')
    expect(email?.html).toContain('Mon, Oct 26')
    expect(email?.text).toContain('- /pricing: 95 views (+86.3%)')
    expect(email?.text).toContain('- Mon, Oct 26: 161')
    expect(email?.text).toContain('Analytics: https://app.example.com/acme/hosts/shop/analytics')
  })

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
    expect(composeWeeklySummarySiteEmail({ ...common, site: site('Shop', 10), aiInsightsUrl: url })?.html).toContain('one thing to do next')
    expect(composeWeeklySummarySiteEmail({ ...common, site: site('Shop', 10), aiInsightsUrl: url })?.text).toContain('and what to do next?')
    expect(composeWeeklySummarySiteEmail({ ...common, site: site('Shop', 10), aiInsightsUrl: url })?.html).toContain(
      `<a href="${url}" style="color:#0077ad;`,
    )
    expect(composeWeeklySummarySiteEmail({ ...common, site: site('Shop', 10) })?.html).not.toContain('AI weekly insights')
  })

  it('keeps its switch under the key the settings page writes', () => {
    expect(NOTIFICATION_DIGESTS[0]).toMatchObject({ pluginId: 'core', key: WEEKLY_SUMMARY_DIGEST_KEY })
  })
})

describe('the AI digest’s drawing (AGL-4130)', () => {
  const COLORS: WeeklySummaryColors = {
    text: '#111111',
    muted: '#555555',
    border: '#dddddd',
    surface: '#f5f5f5',
    accent: '#00aaff',
    link: '#0066cc',
    up: '#008800',
    down: '#cc0000',
  }
  const strong = (figure: string) => `<strong style="font-weight:700;color:#111111;">${figure}</strong>`

  it('writes a date as a person says it', () => {
    expect(weeklySummaryPlainDates('Monday 2026-10-26 was busiest.')).toBe('Monday, Oct 26 was busiest.')
    expect(weeklySummaryPlainDates('From 2026-10-01 to 2026-11-01.')).toBe('From Oct 1 to Nov 1.')
    expect(weeklySummaryPlainDates('Nothing here but 2026 and 10-26.')).toBe('Nothing here but 2026 and 10-26.')
  })

  it('leaves a thing that only looks like a date alone', () => {
    expect(weeklySummaryPlainDates('Code 2026-13-45.')).toBe('Code 2026-13-45.')
  })

  const sentence = (text: string): { headline: string | null; text: string } => ({ headline: null, text })

  it('writes a day as a chart labels it', () => {
    expect(weeklySummaryWeekday('2026-10-26')).toBe('Mon, Oct 26')
  })

  it('opens the AI note with its read of the week, its figures in bold', () => {
    const html = weeklySummaryLeadHtml('The week in short', 'Visitors rose 22.5% on search.', COLORS)
    expect(html).toContain('The week in short')
    expect(html).toContain(strong('22.5%'))
    expect(html).toContain('border-left:3px solid #00aaff')
  })

  it('draws a point’s likely reason, then its next step with its report', () => {
    const html = weeklySummarySectionsHtml(
      [
        {
          points: [
            {
              headline: 'Pricing doubled',
              text: 'It rose into second place.',
              why: 'Likely the new page, published Monday.',
              next: 'Link to it from the home page.',
              nextLink: { label: 'Analytics', url: 'https://app.example.com/analytics' },
            },
          ],
        },
      ],
      COLORS,
    )
    expect(html.indexOf('Likely why:')).toBeGreaterThan(html.indexOf('It rose into second place.'))
    expect(html.indexOf('Try this:')).toBeGreaterThan(html.indexOf('Likely the new page'))
    expect(html).toContain('href="https://app.example.com/analytics"')
    expect(html).toContain('Analytics&nbsp;→')
  })

  it('draws no heading for a section with no title', () => {
    expect(weeklySummarySectionsHtml([{ points: [sentence('Just this.')] }], COLORS)).not.toContain('text-transform:uppercase')
  })

  it('puts a line of small print inside the body', () => {
    expect(weeklySummaryNoteHtml('No campaign ran.', COLORS)).toContain('font-size:13px')
  })

  it('draws a section’s title, its link, its headline, then its sentence', () => {
    const html = weeklySummarySectionsHtml(
      [
        {
          title: 'Top pages',
          link: { label: 'Analytics', url: 'https://app.example.com/analytics' },
          points: [{ headline: 'Home page led', text: 'One.' }],
        },
      ],
      COLORS,
    )
    expect(html.indexOf('Top pages')).toBeLessThan(html.indexOf('href="https://app.example.com/analytics"'))
    expect(html.indexOf('Home page led')).toBeLessThan(html.indexOf('One.'))
  })

  it('puts a hairline between sections, and none above the first', () => {
    const section = { title: 'x', points: [sentence('y')] }
    const html = weeklySummarySectionsHtml([section, section], COLORS)
    expect(html.match(/border-top:1px solid #dddddd/g)).toHaveLength(1)
  })

  it('links a row to the page it names, and shows its figure and change', () => {
    const html = weeklySummarySectionsHtml(
      [
        {
          title: 'x',
          points: [],
          rows: [
            { label: '/pricing', url: 'https://acme.com/pricing', value: '95 views', change: 86.3 },
            { label: '/about', value: '12 views', change: -4 },
          ],
        },
      ],
      COLORS,
    )
    expect(html).toContain('<a href="https://acme.com/pricing"')
    expect(html).toContain('95 views')
    expect(html).toContain('▲ +86.3%')
    expect(html).toContain('▼ −4%')
    expect(html.match(/<a href/g)).toHaveLength(1)
  })

  it('leaves no column for a change no row has', () => {
    const rows = [{ label: 'Contact', value: '14 views · 3 submissions' }]
    const html = weeklySummarySectionsHtml([{ title: 'x', points: [], rows }], COLORS)
    expect(html.match(/<td/g)?.length).toBe(3)
  })

  it('draws a chart with its marked days in the accent, scaled to the busiest', () => {
    const html = weeklySummarySectionsHtml(
      [
        {
          title: 'x',
          points: [],
          bars: [
            { label: 'Mon, Oct 26', value: 160, display: '160', marked: true },
            { label: 'Tue, Oct 27', value: 40, display: '40', marked: false },
          ],
        },
      ],
      COLORS,
    )
    expect(html).toContain('background-color:#00aaff;border-radius:2px;font-size:0;height:10px;line-height:0;width:100%;')
    expect(html).toContain('background-color:#dddddd;border-radius:2px;font-size:0;height:10px;line-height:0;width:25%;')
  })

  it('draws an empty day as a sliver, and survives a week of nothing', () => {
    const html = weeklySummarySectionsHtml(
      [{ title: 'x', points: [], bars: [{ label: 'Mon', value: 0, display: '0', marked: false }] }],
      COLORS,
    )
    expect(html).toContain('width:1%;">&nbsp;')
  })

  it('puts the figures in a sentence in bold, however they are written', () => {
    const html = weeklySummarySectionsHtml(
      [{ title: 'x', points: [sentence('Up 86.3% to 1,204 views, $12.50 an order, −3.3% on the week.')] }],
      COLORS,
    )
    for (const figure of ['86.3%', '1,204', '$12.50', '−3.3%']) expect(html).toContain(strong(figure))
  })

  it('never bolds the digits in an address or a date', () => {
    const html = weeklySummarySectionsHtml(
      [{ title: 'x', points: [sentence('Oct 26 on /page-2/next and a1b.')] }],
      COLORS,
    )
    expect(html).not.toContain('<strong')
  })

  it('escapes what it is given', () => {
    const html = weeklySummarySectionsHtml(
      [
        {
          title: '<i>',
          link: { label: '<u>', url: 'https://x.test/"><script>' },
          points: [{ headline: '<b>', text: 'a <script> b' }],
          rows: [{ label: '<em>', url: 'https://x.test/"y', value: '<s>' }],
        },
      ],
      COLORS,
    )
    expect(html).not.toMatch(/<script>|<b>|<i>|<u>|<em>|<s>|"y/)
  })

  it('links the way out by name in the small print', () => {
    const html = weeklySummaryFootnoteHtml('Used 17 credits.', { label: 'Turn off', url: 'https://x.test/off' }, COLORS)
    expect(html).toContain('Used 17 credits.')
    expect(html).toContain('<a href="https://x.test/off"')
    expect(weeklySummaryFootnoteHtml('Used 17 credits.', null, COLORS)).not.toContain('<a')
  })

  it('draws no tiles for no figures', () => {
    expect(weeklySummaryTilesHtml([], COLORS)).toBe('')
  })

  it('makes a tile the cell itself, so a row’s tiles are one height', () => {
    const html = weeklySummaryTilesHtml(
      [
        { label: 'Visitors', value: '642', change: 22.5 },
        { label: 'Submissions since Oct 1', value: '9' },
      ],
      COLORS,
    )
    expect(html.match(/<td style="width:50%;background-color:#f5f5f5;/g)).toHaveLength(2)
    expect(html).not.toContain('<div style="background-color')
  })
})
