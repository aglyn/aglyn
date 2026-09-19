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

jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  __esModule: true,
  filterEnabledPluginsByReleaseFlags: jest.fn(async (ids: string[]) => ids),
}))

import {
  listPluginFigureReaders,
  registerPluginFigureReader,
  type PluginFigureReader,
  type PluginFigureRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-figures'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { aiInsightReaderDays, aiInsightReaders, readAiInsightTables } from './ai-insight-readers'

/**
 * The caller's half of the figures seam (AGL-2915): a reader is offered only
 * where its plugin runs — past its release flag, on for the workspace and not
 * switched off for the site — and a request is held to the reader's own
 * windows and parameters before it is read.
 */

const NOW = new Date('2026-09-16T15:00:00.000Z')

const reader = (id: string, patch: Partial<PluginFigureReader> = {}): PluginFigureReader => ({
  id,
  label: id,
  description: `${id} figures.`,
  scope: 'site',
  windows: [7, 30],
  read: async (request: PluginFigureRequest) => ({
    ok: true,
    table: {
      title: id,
      source: { label: 'Page', path: 'page' },
      period: null,
      columns: [
        { key: 'label', label: 'Label', kind: 'text' },
        { key: 'days', label: 'Days', kind: 'count' },
      ],
      rows: [{ label: `Owner ${request.params['who'] ?? 'sam@example.com'}`, days: request.days }],
      omitted: 0,
      notes: [],
    },
  }),
  ...patch,
})

beforeEach(() => resetPluginServicesForTests())

describe('which readers are offered', () => {
  beforeEach(() => {
    registerPluginFigureReader(reader('traffic.summary', { plugin: null }), { pluginId: 'ai' })
    registerPluginFigureReader(reader('bookings.services'), { pluginId: 'bookings' })
    registerPluginFigureReader(reader('commerce.sales', { feature: 'commerceAnalytics' }), { pluginId: 'commerce' })
    registerPluginFigureReader(reader('datasets.summary', { scope: 'org', plugin: 'data' }), { pluginId: 'ai' })
  })

  const ids = async (context: Parameters<typeof aiInsightReaders>[0]) =>
    (await aiInsightReaders(context)).map((resolved) => resolved.reader.id)

  it('offers a surface its own kinds of figures, where the plan and the site allow them', async () => {
    const org = { plan: 'pro', billingStatus: 'active', enabledPlugins: ['bookings', 'commerce'] }
    expect(await ids({ orgId: 'org-1', hostId: 'host-1', org, host: {}, surface: 'analytics' })).toEqual([
      'bookings.services',
      'commerce.sales',
      'traffic.summary',
    ])
    // Bookings switched off for this one site.
    expect(
      await ids({ orgId: 'org-1', hostId: 'host-1', org, host: { disabledPlugins: ['bookings'] }, surface: 'analytics' }),
    ).toEqual(['commerce.sales', 'traffic.summary'])
    // A plugin still behind its release flag for this workspace.
    expect(
      await ids({ orgId: 'org-1', hostId: 'host-1', org, host: {}, surface: 'analytics', released: async () => ['commerce'] }),
    ).toEqual(['commerce.sales', 'traffic.summary'])
  })

  it('offers no site reader without a site, and a workspace reader with or without one', async () => {
    const org = { plan: 'pro', billingStatus: 'active', enabledPlugins: ['data'] }
    expect(await ids({ orgId: 'org-1', hostId: null, org, host: null, surface: 'datasets' })).toEqual(['datasets.summary'])
    expect(await ids({ orgId: 'org-1', hostId: null, org, host: null, surface: 'analytics' })).toEqual([])
  })
})

describe('reading', () => {
  it('reads each offered reader once, at a window it covers, with only the parameters it declares', async () => {
    registerPluginFigureReader(
      reader('traffic.pages', { params: [{ name: 'who', description: 'x', required: true }] }),
      { pluginId: 'ai' },
    )
    registerPluginFigureReader(reader('traffic.summary'), { pluginId: 'ai' })
    const readers = listPluginFigureReaders()
    const { tables, refusals } = await readAiInsightTables(
      readers,
      [
        { reader: 'traffic.summary', days: 14, params: {} },
        { reader: 'traffic.summary', days: 7, params: {} },
        { reader: 'traffic.pages', days: 30, params: {} },
        { reader: 'traffic.pages', days: 30, params: { who: 'Avery avery@example.com', extra: 'x' } },
        { reader: 'nobody.knows', days: 7, params: {} },
      ],
      { orgId: 'org-1', hostId: 'host-1', uid: 'uid-1', now: NOW },
    )
    expect(tables.map((table) => [table.ref, table.reader, table.days])).toEqual([
      ['t1', 'traffic.summary', 7],
      ['t2', 'traffic.pages', 30],
    ])
    expect(refusals).toEqual(['traffic.pages: missing who'])
    // Held to the contract on the way in: an address in a label is masked.
    expect(tables[0].rows[0]['label']).toBe('Owner [email]')
    expect(tables[1].rows[0]['label']).toBe('Owner Avery [email]')
    expect(tables[0].scope).toBe('site')
  })

  it('reads the nearest window a reader covers', () => {
    expect(aiInsightReaderDays([7, 30], 14)).toBe(7)
    expect(aiInsightReaderDays([7, 30], 90)).toBe(30)
    expect(aiInsightReaderDays([], 14)).toBe(0)
  })
})
