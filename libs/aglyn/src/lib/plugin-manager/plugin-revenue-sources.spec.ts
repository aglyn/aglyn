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

/**
 * A revenue source that did not answer is refused, never read as nothing
 * earned (AGL-3080) — and the attribution every source groups with never
 * drops a sale to make a table shorter.
 */

import {
  groupRevenueAttribution,
  listRevenueSources,
  PLUGIN_REVENUE_SOURCES,
  readRevenueSources,
  registerRevenueSource,
  type RevenueSourceAnswer,
  type RevenueSourceRequest,
} from './plugin-revenue-sources'
import { resetPluginServicesForTests } from './plugin-services'

const REQUEST: RevenueSourceRequest = {
  period: '2026-08',
  start: new Date(Date.UTC(2026, 7, 1)),
  end: new Date(Date.UTC(2026, 8, 1)),
  attributionLimit: 100,
  sweep: async () => ({ docs: [], truncated: false }),
  orgNames: async () => new Map(),
  nameRows: async () => undefined,
}

const answer = (over: Partial<RevenueSourceAnswer> = {}): RevenueSourceAnswer => ({
  id: 'sales',
  name: 'sales',
  earned: { label: 'Sales commission', cents: 811, note: 'Net of refunds.' },
  grossToNet: [{ label: 'Sales (buyer gross)', cents: 10_000, deduction: false, note: 'Mostly theirs.' }],
  notes: [],
  attribution: [],
  truncated: false,
  failure: null,
  summary: {},
  ...over,
})

describe('the revenue sources', () => {
  beforeEach(() => {
    resetPluginServicesForTests()
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  it('declares the plugins that earn through the platform, from the config', () => {
    expect(PLUGIN_REVENUE_SOURCES).toEqual(['commerce', 'marketplace'])
  })

  it('refuses a declared source that registered nothing', async () => {
    const sections = await readRevenueSources(REQUEST, ['shop'])
    expect(sections).toEqual([
      {
        outcome: 'refused',
        pluginId: 'shop',
        id: 'shop',
        reason: expect.stringContaining('registered nothing'),
      },
    ])
  })

  it('answers a registered source with its owner, asked with the request', async () => {
    const read = jest.fn(async () => answer())
    registerRevenueSource({ read }, { pluginId: 'shop' })
    const [section] = await readRevenueSources(REQUEST, ['shop'])
    expect(section).toMatchObject({ outcome: 'answered', pluginId: 'shop', id: 'sales' })
    expect(read).toHaveBeenCalledWith(REQUEST)
  })

  it('refuses a source that threw, and still answers the others', async () => {
    registerRevenueSource(
      {
        read: async () => {
          throw new Error('index missing')
        },
      },
      { pluginId: 'shop' },
    )
    registerRevenueSource({ read: async () => answer({ id: 'resale' }) }, { pluginId: 'resale' })
    const sections = await readRevenueSources(REQUEST, ['shop', 'resale'])
    expect(sections.map((section) => [section.pluginId, section.outcome])).toEqual([
      ['shop', 'refused'],
      ['resale', 'answered'],
    ])
  })

  it('refuses an earned figure that would not add up', async () => {
    registerRevenueSource(
      { read: async () => answer({ earned: { label: 'x', cents: Number.NaN, note: '' } }) },
      { pluginId: 'shop' },
    )
    expect((await readRevenueSources(REQUEST, ['shop']))[0].outcome).toBe('refused')
  })

  it('refuses the second of two sources answering under one id', async () => {
    registerRevenueSource({ read: async () => answer() }, { pluginId: 'shop' })
    registerRevenueSource({ read: async () => answer() }, { pluginId: 'resale' })
    const sections = await readRevenueSources(REQUEST, ['shop', 'resale'])
    expect(sections.map((section) => section.outcome)).toEqual(['answered', 'refused'])
  })

  it('reads a registered source nobody declared, after the declared ones', async () => {
    registerRevenueSource({ read: async () => answer({ id: 'extra' }) }, { pluginId: 'extra' })
    registerRevenueSource({ read: async () => answer() }, { pluginId: 'shop' })
    const sections = await readRevenueSources(REQUEST, ['shop'])
    expect(sections.map((section) => section.pluginId)).toEqual(['shop', 'extra'])
    expect(listRevenueSources()).toEqual(['extra', 'shop'])
  })

  it('refuses to register something that cannot read', () => {
    expect(() => registerRevenueSource({} as never, { pluginId: 'shop' })).toThrow(/read/)
  })
})

describe('groupRevenueAttribution', () => {
  it('keeps a row whose key is missing rather than dropping the money', () => {
    const table = groupRevenueAttribution(
      [
        { key: 'a', detail: '', gain: 300, loss: 0 },
        { key: '', detail: '', gain: 200, loss: 10 },
      ],
      100,
      'Not recorded',
    )
    expect(table.rows.map((row) => [row.key, row.name, row.gainCents])).toEqual([
      ['a', 'a', 300],
      ['Not recorded', 'Not recorded', 200],
    ])
  })

  it('carries the omitted remainder as figures when it caps', () => {
    const table = groupRevenueAttribution(
      [
        { key: 'a', detail: '', gain: 300, loss: 5 },
        { key: 'b', detail: '', gain: 200, loss: 7 },
        { key: 'c', detail: '', gain: 100, loss: 11 },
      ],
      1,
      'Not recorded',
    )
    expect(table.rows.map((row) => row.key)).toEqual(['a'])
    expect(table).toMatchObject({ omittedRows: 2, omittedGainCents: 300, omittedLossCents: 18 })
  })
})
