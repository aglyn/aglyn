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
 * A tax return source that did not answer is refused, never read as nothing
 * sold (AGL-3080).
 *
 * Every case is the same property from a different direction: the return is
 * a legal filing, and a source missing from it is indistinguishable, on a
 * total, from a source that sold nothing. So the one outcome that must be
 * impossible is a declared source quietly absent from the sections.
 */

import {
  listTaxReturnSources,
  PLUGIN_TAX_RETURN_SOURCES,
  readTaxReturnSources,
  registerTaxReturnSource,
  type TaxReturnSourceAnswer,
  type TaxReturnSourceRequest,
} from './plugin-tax-return-sources'
import { resetPluginServicesForTests } from './plugin-services'

const REQUEST: TaxReturnSourceRequest = {
  period: '2026-Q3',
  start: new Date(Date.UTC(2026, 6, 1)),
  end: new Date(Date.UTC(2026, 9, 1)),
  filing: { code: 'US-TX', label: 'Texas', form: 'tx-webfile', figuresName: 'Items 1–3' },
  rowCap: 2000,
}

const answer = (over: Partial<TaxReturnSourceAnswer> = {}): TaxReturnSourceAnswer => ({
  id: 'sales',
  name: 'Sales',
  title: 'Sales tax — the plugin’s sales',
  help: 'What the plugin sold.',
  intro: 'None of this is in the filing figures above.',
  truncated: false,
  undatedRows: 0,
  findings: [{ id: 'salesTax', severity: 'blocking', count: 825, label: 'Tax held', detail: 'Decide.' }],
  filingLines: [],
  tables: [],
  figures: [],
  exports: [],
  summary: { taxCollectedCents: 825 },
  rows: [],
  ...over,
})

describe('the tax return sources', () => {
  beforeEach(() => {
    resetPluginServicesForTests()
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('declares the plugins that sell through the platform, from the config', () => {
    // The compiled list is what makes an absent registration a refusal. If
    // it were empty, every case below would pass while the return read no
    // plugin at all.
    expect(PLUGIN_TAX_RETURN_SOURCES).toEqual(['commerce', 'marketplace'])
  })

  it('refuses a declared source that registered nothing', async () => {
    // ⛔ The case that matters most: an empty registry reads exactly like a
    // deployment where nothing sells.
    const sections = await readTaxReturnSources(REQUEST, ['shop'])
    expect(sections).toEqual([
      {
        outcome: 'refused',
        pluginId: 'shop',
        id: 'shop',
        reason: expect.stringContaining('registered nothing'),
      },
    ])
  })

  it('answers a registered source with its owner', async () => {
    registerTaxReturnSource({ read: async () => answer() }, { pluginId: 'shop' })
    const [section] = await readTaxReturnSources(REQUEST, ['shop'])
    expect(section).toMatchObject({ outcome: 'answered', pluginId: 'shop', id: 'sales' })
  })

  it('hands every source the same request', async () => {
    const read = jest.fn(async () => answer())
    registerTaxReturnSource({ read }, { pluginId: 'shop' })
    await readTaxReturnSources(REQUEST, ['shop'])
    expect(read).toHaveBeenCalledWith(REQUEST)
  })

  it('refuses a source that threw, and still answers the others', async () => {
    registerTaxReturnSource(
      {
        read: async () => {
          throw new Error('index missing')
        },
      },
      { pluginId: 'shop' },
    )
    registerTaxReturnSource({ read: async () => answer({ id: 'resale' }) }, { pluginId: 'resale' })
    const sections = await readTaxReturnSources(REQUEST, ['shop', 'resale'])
    expect(sections.map((section) => [section.pluginId, section.outcome])).toEqual([
      ['shop', 'refused'],
      ['resale', 'answered'],
    ])
  })

  it('refuses an answer whose counts would not sum', async () => {
    // A NaN count sums the verdict to NaN, and `NaN === 0` is false both
    // ways — a finding that could read clean while money sat behind it.
    registerTaxReturnSource(
      {
        read: async () =>
          answer({
            findings: [{ id: 'x', severity: 'blocking', count: Number.NaN, label: 'x', detail: 'x' }],
          }),
      },
      { pluginId: 'shop' },
    )
    const [section] = await readTaxReturnSources(REQUEST, ['shop'])
    expect(section.outcome).toBe('refused')
  })

  it('refuses an answer missing a list, rather than showing nothing', async () => {
    registerTaxReturnSource(
      { read: async () => ({ ...answer(), exports: undefined }) as never },
      { pluginId: 'shop' },
    )
    const [section] = await readTaxReturnSources(REQUEST, ['shop'])
    expect(section.outcome).toBe('refused')
  })

  it('refuses the second of two sources answering under one id', async () => {
    registerTaxReturnSource({ read: async () => answer() }, { pluginId: 'shop' })
    registerTaxReturnSource({ read: async () => answer() }, { pluginId: 'resale' })
    const sections = await readTaxReturnSources(REQUEST, ['shop', 'resale'])
    expect(sections.map((section) => section.outcome)).toEqual(['answered', 'refused'])
  })

  it('reads a registered source nobody declared, after the declared ones', async () => {
    // A source is how a plugin puts its sales on the return; declaring it is
    // how the return knows to refuse without it. An undeclared one still
    // answers — it simply cannot be missed.
    registerTaxReturnSource({ read: async () => answer({ id: 'extra' }) }, { pluginId: 'extra' })
    registerTaxReturnSource({ read: async () => answer() }, { pluginId: 'shop' })
    const sections = await readTaxReturnSources(REQUEST, ['shop'])
    expect(sections.map((section) => section.pluginId)).toEqual(['shop', 'extra'])
    expect(listTaxReturnSources()).toEqual(['extra', 'shop'])
  })

  it('keeps one source per plugin when it registers twice', async () => {
    registerTaxReturnSource({ read: async () => answer({ title: 'first' }) }, { pluginId: 'shop' })
    registerTaxReturnSource({ read: async () => answer({ title: 'second' }) }, { pluginId: 'shop' })
    const sections = await readTaxReturnSources(REQUEST, ['shop'])
    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({ title: 'second' })
  })

  it('refuses to register something that cannot read', () => {
    expect(() => registerTaxReturnSource({} as never, { pluginId: 'shop' })).toThrow(/read/)
  })
})
