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
import type { PluginFigureColumn, PluginFigureRow, PluginFigureTable } from '../plugin-manager/plugin-figures'
import {
  composeWeeklySummaryEmailText,
  composeWeeklySummarySubject,
  WEEKLY_SUMMARY_DIGEST_KEY,
  weeklySummaryLines,
  weeklySummaryPeriod,
  type WeeklySummaryEmailInput,
  type WeeklySummarySite,
} from './weekly-summary'

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

const SUMMARY_COLUMNS: PluginFigureColumn[] = [
  { key: 'figure', label: 'Figure', kind: 'text' },
  { key: 'current', label: 'This window', kind: 'count' },
  { key: 'previous', label: 'Window before', kind: 'count' },
  { key: 'change', label: 'Change', kind: 'change' },
]

const traffic = (visitors: number) =>
  table(SUMMARY_COLUMNS, [
    { figure: 'Page views', current: 3_410, previous: 3_150, change: 8.3 },
    { figure: 'Visitors', current: visitors, previous: 1_000, change: visitors ? 20.4 : -100 },
  ])

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

describe('the weekly summary lines', () => {
  it('words each known reader from its own columns', () => {
    expect(weeklySummaryLines({ reader: 'traffic.summary', table: traffic(1_204) })).toEqual([
      'Visitors: 1,204 (+20.4%) · Page views: 3,410 (+8.3%)',
    ])
    expect(
      weeklySummaryLines({
        reader: 'traffic.pages',
        table: table(
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
        ),
      }),
    ).toEqual(['Top pages: / 1,020 views, /pricing 340, /contact 120'])
    expect(
      weeklySummaryLines({
        reader: 'forms.performance',
        table: table(
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
        ),
      }),
    ).toEqual(['Form submissions since Oct 1: 14 (Contact us 10, Quote 4)'])
    expect(
      weeklySummaryLines({
        reader: 'crm.people',
        table: table(SUMMARY_COLUMNS, [
          { figure: 'New leads', current: 9, previous: 6, change: 50 },
          { figure: 'New contacts', current: 3, previous: 0, change: null },
        ]),
      }),
    ).toEqual(['New leads: 9 (+50%) · New contacts: 3'])
    expect(
      weeklySummaryLines({
        reader: 'bookings.services',
        table: table(
          [
            { key: 'service', label: 'Service', kind: 'text' },
            { key: 'booked', label: 'Booked', kind: 'count' },
            { key: 'canceled', label: 'Canceled', kind: 'count' },
            { key: 'change', label: 'Change in bookings', kind: 'change' },
          ],
          [
            { service: 'All services', booked: 6, canceled: 1, change: null },
            { service: 'Haircut', booked: 4, canceled: 1, change: null },
            { service: 'Color', booked: 2, canceled: 0, change: null },
          ],
        ),
      }),
    ).toEqual(['Bookings: 6, 1 canceled (Haircut 4, Color 2)'])
    expect(
      weeklySummaryLines({
        reader: 'commerce.sales',
        table: table(
          [
            { key: 'window', label: 'Window', kind: 'text' },
            { key: 'revenue', label: 'Revenue', kind: 'money', currency: 'USD' },
            { key: 'orders', label: 'Orders', kind: 'count' },
            { key: 'revenueChange', label: 'Revenue change', kind: 'change' },
          ],
          [
            { window: 'this', revenue: 1_240, orders: 18, revenueChange: 20 },
            { window: 'before', revenue: 1_033, orders: 15, revenueChange: null },
          ],
        ),
      }),
    ).toEqual(['Sales: $1,240.00 (+20%) from 18 orders'])
    expect(
      weeklySummaryLines({
        reader: 'crm.closed',
        table: table(
          [
            { key: 'won', label: 'Won', kind: 'count' },
            { key: 'lost', label: 'Lost', kind: 'count' },
            { key: 'wonValue', label: 'Value won', kind: 'money', currency: 'USD' },
          ],
          [{ won: 2, lost: 1, wonValue: 5_000 }],
        ),
      }),
    ).toEqual(['Deals: 2 won ($5,000.00), 1 lost'])
    expect(
      weeklySummaryLines({
        reader: 'crm.pipeline',
        table: table(
          [
            { key: 'pipeline', label: 'Pipeline', kind: 'text' },
            { key: 'deals', label: 'Open deals', kind: 'count' },
            { key: 'value', label: 'Value', kind: 'money', currency: 'USD' },
          ],
          [{ pipeline: 'All pipelines', deals: 12, value: 40_000 }],
        ),
      }),
    ).toEqual(['Open pipeline: 12 deals worth $40,000.00'])
    expect(
      weeklySummaryLines({
        reader: 'automations.runs',
        table: table(
          [
            { key: 'automation', label: 'Automation', kind: 'text' },
            { key: 'succeeded', label: 'Succeeded', kind: 'count' },
            { key: 'failed', label: 'Failed', kind: 'count' },
          ],
          [{ automation: 'All automations', succeeded: 54, failed: 2 }],
        ),
      }),
    ).toEqual(['Automations: 54 runs finished, 2 failed'])
  })

  it('drops a reader with nothing to report', () => {
    expect(
      weeklySummaryLines({
        reader: 'traffic.summary',
        table: table(SUMMARY_COLUMNS, [
          { figure: 'Page views', current: 0, previous: 10, change: -100 },
          { figure: 'Visitors', current: 0, previous: 4, change: -100 },
        ]),
      }),
    ).toEqual([])
    expect(
      weeklySummaryLines({
        reader: 'bookings.services',
        table: table(
          [
            { key: 'service', label: 'Service', kind: 'text' },
            { key: 'booked', label: 'Booked', kind: 'count' },
          ],
          [{ service: 'All services', booked: 0 }],
        ),
      }),
    ).toEqual([])
  })

  it('reads a reader whose shape it does not know as its first row, labeled', () => {
    expect(
      weeklySummaryLines({
        reader: 'acme.widgets',
        table: table(
          [
            { key: 'name', label: 'Widget', kind: 'text' },
            { key: 'made', label: 'Made', kind: 'count' },
          ],
          [{ name: 'Sprocket', made: 7 }],
          { title: 'Widgets' },
        ),
      }),
    ).toEqual(['Widgets (Sprocket): Made 7'])
  })
})

describe('the weekly summary email', () => {
  const site = (name: string, visitors: number): WeeklySummarySite => ({
    name,
    url: `https://app.example.com/acme/hosts/${name.toLowerCase()}`,
    tables: [{ reader: 'traffic.summary', table: traffic(visitors) }],
  })
  const input: Omit<WeeklySummaryEmailInput, 'sites'> = {
    workspaceName: 'Acme',
    productName: 'Aglyn',
    periodLabel: 'Oct 5 – Oct 11',
    workspaceTables: [],
    aiInsightsUrl: null,
    settingsUrl: 'https://app.example.com/manage/notifications/settings',
  }

  it('leads the subject with the week’s figures', () => {
    expect(composeWeeklySummarySubject('Acme', [site('Shop', 1_204), site('Blog', 96)])).toBe(
      'Your week at Acme: 1,300 visitors',
    )
    expect(composeWeeklySummarySubject('Acme', [])).toBe('Your week at Acme')
  })

  it('lists each site with something to say, with its link, and leaves the rest out', () => {
    const text = composeWeeklySummaryEmailText({ ...input, sites: [site('Shop', 1_204)] }) ?? ''
    expect(text).toContain('Here is how Acme did last week, Oct 5 – Oct 11.')
    expect(text).toContain('Shop\n- Visitors: 1,204 (+20.4%) · Page views: 3,410 (+8.3%)')
    expect(text).toContain('Open Shop in Aglyn: https://app.example.com/acme/hosts/shop')
    expect(text).toContain('Turn it off in Notifications: https://app.example.com/manage/notifications/settings')
    expect(composeWeeklySummaryEmailText({ ...input, sites: [site('Shop', 1_204)], omitClosing: true })).not.toContain(
      'Turn it off',
    )
  })

  it('is not sent at all for a week with nothing in it', () => {
    const quiet: WeeklySummarySite = {
      name: 'Quiet',
      url: null,
      tables: [
        {
          reader: 'traffic.summary',
          table: table(SUMMARY_COLUMNS, [
            { figure: 'Page views', current: 0, previous: 0, change: null },
            { figure: 'Visitors', current: 0, previous: 0, change: null },
          ]),
        },
      ],
    }
    expect(composeWeeklySummaryEmailText({ ...input, sites: [quiet] })).toBeNull()
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
