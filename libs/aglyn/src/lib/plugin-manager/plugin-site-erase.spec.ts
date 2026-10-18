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
 * `core.site-erase` (AGL-3936): a process that never installed the app's
 * eraser answers `unavailable`, never a deletion that did not happen, and an
 * eraser that throws answers the same.
 */

import {
  erasePluginSite,
  hasPluginSiteEraser,
  registerPluginSiteEraser,
  type PluginSiteEraseRequest,
} from './plugin-site-erase'
import { resetPluginServicesForTests } from './plugin-services'

const REQUEST: PluginSiteEraseRequest = {
  hostId: 'host-1',
  orgId: 'org-1',
  activity: 'Removed an empty site',
  reason: 'ai-start-empty',
}

beforeEach(() => {
  resetPluginServicesForTests()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('core.site-erase', () => {
  it('answers unavailable, out loud, when nothing is installed', async () => {
    expect(hasPluginSiteEraser()).toBe(false)
    expect(await erasePluginSite(REQUEST)).toEqual({ erased: false, reason: 'unavailable' })
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('no implementation is installed'))
  })

  it('hands the request to the installed eraser and returns its answer', async () => {
    const seen: PluginSiteEraseRequest[] = []
    registerPluginSiteEraser(
      {
        erase: async (request) => {
          seen.push(request)
          return { erased: true }
        },
      },
      { pluginId: 'console' },
    )
    expect(hasPluginSiteEraser()).toBe(true)
    expect(await erasePluginSite(REQUEST)).toEqual({ erased: true })
    expect(seen).toEqual([REQUEST])
  })

  it('turns an eraser that throws into unavailable', async () => {
    registerPluginSiteEraser(
      {
        erase: async () => {
          throw new Error('boom')
        },
      },
      { pluginId: 'console' },
    )
    expect(await erasePluginSite(REQUEST)).toEqual({ erased: false, reason: 'unavailable' })
  })

  it('refuses an eraser without an erase function', () => {
    expect(() => registerPluginSiteEraser({} as never, { pluginId: 'console' })).toThrow('erase function')
  })
})
