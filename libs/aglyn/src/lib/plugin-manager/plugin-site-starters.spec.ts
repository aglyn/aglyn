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

import { setRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  describeSiteStarter,
  registerPluginSiteStarterSource,
  resolveSiteStarterSource,
  type PluginSiteStarterSource,
  type SiteStarterSummary,
} from './plugin-site-starters'
import { resetPluginServicesForTests } from './plugin-services'

const source = (): PluginSiteStarterSource => ({
  search: async () => [],
  resolve: async () => ({ error: 'gone', status: 404 }),
})

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('site starter source (AGL-4049)', () => {
  it('is null with no plugin registered', () => {
    expect(resolveSiteStarterSource()).toBeNull()
  })

  it('resolves the plugin that registered', () => {
    const impl = source()
    registerPluginSiteStarterSource(impl, { pluginId: 'starters' })
    expect(resolveSiteStarterSource()).toBe(impl)
  })

  it('refuses a second plugin, and the first keeps serving', () => {
    const first = source()
    registerPluginSiteStarterSource(first, { pluginId: 'starters' })
    expect(() => registerPluginSiteStarterSource(source(), { pluginId: 'other' })).toThrow(/single-implementation/)
    expect(resolveSiteStarterSource()).toBe(first)
  })

  it('takes a source that counts installs, and one that does not', async () => {
    const counted: string[] = []
    const counting: PluginSiteStarterSource = {
      ...source(),
      installed: async (choice, _viewer, site) => {
        counted.push(`${choice.listingId}:${site.hostId}`)
      },
    }
    registerPluginSiteStarterSource(counting, { pluginId: 'starters' })
    await resolveSiteStarterSource()?.installed?.({ listingId: 'l1' }, { orgId: 'o1', uid: 'u1' }, { hostId: 'h1' })
    expect(counted).toEqual(['l1:h1'])

    registerPluginSiteStarterSource(source(), { pluginId: 'starters' })
    expect(resolveSiteStarterSource()?.installed).toBeUndefined()
  })

  it('lets the same plugin register again, replacing itself', () => {
    registerPluginSiteStarterSource(source(), { pluginId: 'starters' })
    const again = source()
    registerPluginSiteStarterSource(again, { pluginId: 'starters' })
    expect(resolveSiteStarterSource()).toBe(again)
  })
})

describe('describe, optional and best-effort (AGL-4049 lane 3)', () => {
  const VIEWER = { orgId: 'o1', uid: 'u1' }
  const SUMMARY: SiteStarterSummary = {
    listingId: 'l1',
    displayName: 'Corner bistro',
    description: '',
    authorName: 'Pub',
    official: false,
    priceUsd: 0,
    previewImageUrl: null,
    facets: { kind: 'restaurant', base: 'starter', fonts: null, pages: 1, mode: 'base' },
  }

  it('answers what the source describes, for that viewer', async () => {
    const describe = jest.fn(async () => SUMMARY)
    registerPluginSiteStarterSource({ ...source(), describe }, { pluginId: 'starters' })
    expect(await describeSiteStarter(resolveSiteStarterSource(), { listingId: 'l1' }, VIEWER)).toBe(SUMMARY)
    expect(describe).toHaveBeenCalledWith({ listingId: 'l1' }, VIEWER)
  })

  it('is null for a source that cannot describe, for no source, and for no listing', async () => {
    registerPluginSiteStarterSource(source(), { pluginId: 'starters' })
    expect(resolveSiteStarterSource()?.describe).toBeUndefined()
    expect(await describeSiteStarter(resolveSiteStarterSource(), { listingId: 'l1' }, VIEWER)).toBeNull()
    expect(await describeSiteStarter(null, { listingId: 'l1' }, VIEWER)).toBeNull()
    const describe = jest.fn(async () => SUMMARY)
    expect(await describeSiteStarter({ ...source(), describe }, { listingId: '' }, VIEWER)).toBeNull()
    expect(describe).not.toHaveBeenCalled()
  })

  it('never throws, and never answers a different listing than the one asked', async () => {
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const failing = { ...source(), describe: async (): Promise<SiteStarterSummary | null> => { throw new Error('down') } }
    expect(await describeSiteStarter(failing, { listingId: 'l1' }, VIEWER)).toBeNull()
    const other = { ...source(), describe: async () => ({ ...SUMMARY, listingId: 'l2' }) }
    expect(await describeSiteStarter(other, { listingId: 'l1' }, VIEWER)).toBeNull()
    quiet.mockRestore()
  })
})
