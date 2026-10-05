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
 * The addresses plugins serve from a site's screens (AGL-3475): what a publish
 * adds to the pages it drops, and how a reader that fails costs it nothing.
 */

import {
  PLUGIN_LIVE_PATHS_MAX,
  pluginLivePaths,
  registerPluginLivePaths,
  resetPluginLivePathsForTests,
} from './plugin-live-paths'

beforeEach(() => resetPluginLivePathsForTests())

describe('plugin live paths', () => {
  it('is every plugin’s answer, site-absolute and without duplicates', async () => {
    registerPluginLivePaths(async () => ['/services/roofing', '/services/siding'], {
      pluginId: 'data',
    })
    registerPluginLivePaths(async () => ['/services/roofing', 'not-absolute'], {
      pluginId: 'other',
    })
    expect(await pluginLivePaths({ hostId: 'h1' })).toEqual([
      '/services/roofing',
      '/services/siding',
    ])
  })

  it('hands each reader the screens being published', async () => {
    const reader = jest.fn(async (): Promise<string[]> => [])
    registerPluginLivePaths(reader, { pluginId: 'data' })
    await pluginLivePaths({ hostId: 'h1', screenIds: ['tmpl'] })
    expect(reader).toHaveBeenCalledWith({ hostId: 'h1', screenIds: ['tmpl'] })
  })

  it('asks nobody about an empty set of screens', async () => {
    const reader = jest.fn(async () => ['/x'])
    registerPluginLivePaths(reader, { pluginId: 'data' })
    expect(await pluginLivePaths({ hostId: 'h1', screenIds: [] })).toEqual([])
    expect(reader).not.toHaveBeenCalled()
  })

  it('skips a reader that throws, and keeps the others', async () => {
    registerPluginLivePaths(
      async () => {
        throw new Error('unavailable')
      },
      { pluginId: 'broken' },
    )
    registerPluginLivePaths(async () => ['/ok'], { pluginId: 'data' })
    jest.spyOn(console, 'error').mockImplementationOnce(() => undefined)
    expect(await pluginLivePaths({ hostId: 'h1' })).toEqual(['/ok'])
  })

  it('bounds what one reader contributes', async () => {
    registerPluginLivePaths(
      async () => Array.from({ length: PLUGIN_LIVE_PATHS_MAX + 5 }, (_, i) => `/p/${i}`),
      { pluginId: 'data' },
    )
    expect(await pluginLivePaths({ hostId: 'h1' })).toHaveLength(PLUGIN_LIVE_PATHS_MAX)
  })

  it('refuses a reader with no owner', () => {
    expect(() => registerPluginLivePaths(async () => [])).toThrow(/no owner/)
  })
})
