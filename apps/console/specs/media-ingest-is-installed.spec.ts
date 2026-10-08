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
 * THIS APP INSTALLS THE MEDIA INGEST AT BOOT (AGL-3660).
 *
 * An AI job copying a stock photo asks core for `core.media-ingest`; a
 * process that never registered it answers `null`, and every site built
 * there quietly keeps the starter photos. So this drives the real
 * `register()` and checks that what a plugin calls reaches this app's
 * implementation. The implementation's own checks are held in
 * `utils/server/media-ingest.spec.ts`.
 */

export {}

const mockCalls: unknown[] = []

jest.mock('../constants/plugins.declarations.server.generated', () => ({
  __esModule: true,
  registerPluginServerDeclarations: async () => undefined,
}))

jest.mock('../utils/server/media-ingest', () => ({
  __esModule: true,
  consoleMediaIngest: {
    ingest: async (request: unknown) => {
      mockCalls.push(['ingest', request])
      return { ok: false, status: 403, reason: 'test' }
    },
    findStockPhoto: async (input: unknown) => {
      mockCalls.push(['find', input])
      return null
    },
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => ({}) }) },
}))

import { pluginMediaIngest } from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'
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

describe('the media ingest is installed by this app', () => {
  it('CONTROL: nothing answers before the boot step runs', () => {
    expect(pluginMediaIngest()).toBeNull()
  })

  it('and both halves reach this app once it has', async () => {
    await register()
    const ingest = pluginMediaIngest()
    expect(ingest).not.toBeNull()
    await ingest?.findStockPhoto({ hostId: 'h1', sourceKey: 'pixabay:1' })
    await ingest?.ingest({
      hostId: 'h1',
      uid: 'u1',
      fileName: 'a.jpg',
      contentType: 'image/jpeg',
      bytes: new Uint8Array([1]),
    })
    expect(mockCalls.map(([kind]) => kind)).toEqual(['find', 'ingest'])
  })
})
