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
 * A plugin's share of deleting a site (AGL-4003): what goes is previewed
 * before anyone confirms, and each plugin's erase is isolated from the next.
 */
import { setRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  registerPluginDeclarationsRepair,
  resetPluginDeclarationsRepairForTests,
} from './plugin-declarations-repair'
import {
  erasePluginSiteResources,
  listPluginSiteResourceErasers,
  previewPluginSiteResources,
  registerPluginSiteResourceEraser,
  resetPluginSiteResourceErasersForTests,
  type PluginSiteResourcePreview,
} from './plugin-site-resources'

const REQUEST = { orgId: 'org-a', hostId: 'host-1' }
const PREVIEW: PluginSiteResourcePreview = {
  noun: ['dataset', 'datasets'],
  itemNoun: ['record', 'records'],
  going: [{ id: 'ds-1', name: 'Gallery collections', items: 12 }],
  staying: 1,
}

beforeEach(() => {
  resetPluginSiteResourceErasersForTests()
  resetPluginDeclarationsRepairForTests()
  setRegisteringPluginId(undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('a plugin’s share of deleting a site (AGL-4003)', () => {
  it('previews and erases through each registered plugin, with the site and workspace', async () => {
    const preview = jest.fn(async () => PREVIEW)
    const erase = jest.fn(async () => 1)
    registerPluginSiteResourceEraser({ preview, erase }, { pluginId: 'data' })

    expect(await previewPluginSiteResources(REQUEST)).toEqual([{ pluginId: 'data', preview: PREVIEW }])
    expect(preview).toHaveBeenCalledWith(REQUEST)
    expect(erase).not.toHaveBeenCalled()

    expect(await erasePluginSiteResources(REQUEST)).toEqual({ data: 1 })
    expect(erase).toHaveBeenCalledWith(REQUEST)
  })

  it('isolates a plugin that throws: the next one still runs, and the failure is null', async () => {
    registerPluginSiteResourceEraser(
      {
        preview: async () => {
          throw new Error('offline')
        },
        erase: async () => {
          throw new Error('offline')
        },
      },
      { pluginId: 'broken' },
    )
    const erase = jest.fn(async () => 2)
    registerPluginSiteResourceEraser({ preview: async () => PREVIEW, erase }, { pluginId: 'data' })

    expect(await previewPluginSiteResources(REQUEST)).toEqual([
      { pluginId: 'broken', preview: null },
      { pluginId: 'data', preview: PREVIEW },
    ])
    expect(await erasePluginSiteResources(REQUEST)).toEqual({ broken: null, data: 2 })
    expect(erase).toHaveBeenCalledTimes(1)
  })

  it('replaces a plugin’s eraser when it registers again, so nothing erases twice', async () => {
    const first = jest.fn(async () => 1)
    const second = jest.fn(async () => 1)
    registerPluginSiteResourceEraser({ preview: async () => PREVIEW, erase: first }, { pluginId: 'data' })
    registerPluginSiteResourceEraser({ preview: async () => PREVIEW, erase: second }, { pluginId: 'data' })

    await erasePluginSiteResources(REQUEST)
    expect(listPluginSiteResourceErasers()).toEqual(['data'])
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('runs the app’s boot step once when no plugin has registered, then asks', async () => {
    const erase = jest.fn(async () => 3)
    registerPluginDeclarationsRepair(async () => {
      registerPluginSiteResourceEraser({ preview: async () => PREVIEW, erase }, { pluginId: 'data' })
    })

    expect(await erasePluginSiteResources(REQUEST)).toEqual({ data: 3 })
  })

  it('refuses an eraser with no owner, or without both halves', () => {
    expect(() =>
      registerPluginSiteResourceEraser({ preview: async () => PREVIEW, erase: async () => 0 }),
    ).toThrow(/no owner/)
    expect(() =>
      registerPluginSiteResourceEraser({ preview: async () => PREVIEW } as never, { pluginId: 'data' }),
    ).toThrow(/preview and an erase/)
  })
})
