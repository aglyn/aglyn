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
 * THIS APP INSTALLS THE SITE ERASER AT BOOT (AGL-3936).
 *
 * The AI jobs beat removes the empty site a cancelled guided start left by
 * asking core for `core.site-erase`; a process that never registered it
 * answers `unavailable`, and every such site stays up. So this drives the
 * real `register()` and checks that what the plugin calls reaches this
 * app's implementation. The implementation's own checks are held in
 * `utils/server/erase-site.spec.ts`.
 */

export {}

const mockCalls: unknown[] = []

jest.mock('../constants/plugins.declarations.server.generated', () => ({
  __esModule: true,
  registerPluginServerDeclarations: async () => undefined,
}))

jest.mock('../utils/server/erase-site', () => ({
  __esModule: true,
  consoleSiteEraser: {
    erase: async (request: unknown) => {
      mockCalls.push(request)
      return { erased: true }
    },
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => ({}) }) },
}))

import { erasePluginSite, hasPluginSiteEraser } from '@aglyn/aglyn/plugin-manager/plugin-site-erase'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { register } from '../instrumentation'

const NODE_RUNTIME = process.env.NEXT_RUNTIME

beforeEach(() => {
  process.env.NEXT_RUNTIME = 'nodejs'
  resetPluginServicesForTests()
  mockCalls.length = 0
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
  if (NODE_RUNTIME === undefined) delete process.env.NEXT_RUNTIME
  else process.env.NEXT_RUNTIME = NODE_RUNTIME
})

describe('the site eraser is installed by this app', () => {
  it('CONTROL: nothing answers before the boot step runs', async () => {
    expect(hasPluginSiteEraser()).toBe(false)
    expect(await erasePluginSite({ hostId: 'h1', orgId: 'o1', activity: 'x', reason: 'y' })).toEqual({
      erased: false,
      reason: 'unavailable',
    })
  })

  it('and a plugin’s request reaches this app once it has', async () => {
    await register()
    const request = { hostId: 'h1', orgId: 'o1', activity: 'Removed an empty site', reason: 'ai-start-empty' }
    expect(await erasePluginSite(request)).toEqual({ erased: true })
    expect(mockCalls).toEqual([request])
  })
})
