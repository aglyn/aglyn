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

import {
  registerPluginDeclarationsRepair,
  resetPluginDeclarationsRepairForTests,
} from './plugin-declarations-repair'
import {
  listDeclaredSiteBundleSections,
  registerPluginSiteBundleSection,
  resetSiteBundleSectionsForTests,
  resolveSiteBundleSections,
  type PluginSiteBundleSection,
} from './plugin-site-bundle'

/**
 * The sections of the site backup plugins answer for (AGL-3080), read the
 * way the export and restore read them: the compiled declarations, joined to
 * what the plugins registered. The property that matters is the refusal — a
 * section declared and missing must fail the backup, never shorten it.
 */
const ANSWERS: PluginSiteBundleSection = {
  export: async () => [],
  import: async () => [],
}

const declared = listDeclaredSiteBundleSections()

afterEach(() => {
  resetSiteBundleSectionsForTests()
  resetPluginDeclarationsRepairForTests()
})

describe('declared site bundle sections', () => {
  it('declares at least one, or every case below proves nothing', () => {
    expect(declared.length).toBeGreaterThan(0)
  })

  it('gives each key one owner', () => {
    const keys = declared.map((one) => one.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('registering a section', () => {
  it('is refused with no owner', () => {
    expect(() => registerPluginSiteBundleSection(declared[0].key, ANSWERS)).toThrow(/no owner/)
  })

  it('is refused for a key nobody declared, which no export would carry', () => {
    expect(() =>
      registerPluginSiteBundleSection('bottles', ANSWERS, { pluginId: 'cellar' }),
    ).toThrow(/not declared/)
  })

  it('is refused for a key another plugin declared', () => {
    const [first] = declared
    expect(() =>
      registerPluginSiteBundleSection(first.key, ANSWERS, { pluginId: `not-${first.pluginId}` }),
    ).toThrow(/declared by/)
  })
})

describe('resolving the sections', () => {
  it('THROWS naming a section declared and never registered', async () => {
    await expect(resolveSiteBundleSections()).rejects.toThrow(declared[0].key)
  })

  it('runs the app’s declarations step once before refusing, and answers if that registers it', async () => {
    const repair = jest.fn(async () => {
      for (const one of declared) {
        registerPluginSiteBundleSection(one.key, ANSWERS, { pluginId: one.pluginId })
      }
    })
    registerPluginDeclarationsRepair(repair)

    const resolved = await resolveSiteBundleSections()

    expect(repair).toHaveBeenCalledTimes(1)
    expect(resolved.map((one) => one.key)).toEqual(declared.map((one) => one.key))
    expect(resolved[0].section).toBe(ANSWERS)
  })

  it('answers every declared section, in config order, once each is registered', async () => {
    for (const one of [...declared].reverse()) {
      registerPluginSiteBundleSection(one.key, ANSWERS, { pluginId: one.pluginId })
    }
    const resolved = await resolveSiteBundleSections()
    expect(resolved.map(({ key, limit, pluginId }) => ({ key, limit, pluginId }))).toEqual(
      declared.map(({ key, limit, pluginId }) => ({ key, limit, pluginId })),
    )
  })
})
