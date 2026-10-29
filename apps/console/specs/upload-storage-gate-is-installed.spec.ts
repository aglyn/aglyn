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
 * THIS APP INSTALLS THE UPLOAD STORAGE GATE AT BOOT (AGL-4096).
 *
 * A quote's proof asks core for `core.upload-storage-gate` before it is
 * taken; a process that never registered it answers `null`, and a proof
 * would skip the storage band a library upload meets. So this drives the
 * real `register()` and checks that the question reaches this app's
 * implementation. The implementation's own verdicts are held in
 * `utils/server/upload-storage-gate.spec.ts`.
 */

export {}

const mockCalls: unknown[] = []

jest.mock('../constants/plugins.declarations.server.generated', () => ({
  __esModule: true,
  registerPluginServerDeclarations: async () => undefined,
}))

jest.mock('../utils/server/upload-storage-gate', () => ({
  __esModule: true,
  consoleUploadStorageGate: {
    check: async (input: unknown) => {
      mockCalls.push(input)
      return { status: 403, error: 'test', code: 'plan_limit_reached' }
    },
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => ({}) }) },
}))

import { uploadStorageGate } from '@aglyn/aglyn/plugin-manager/plugin-upload-storage-gate'
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

describe('the upload storage gate is installed by this app', () => {
  it('CONTROL: nothing answers before the boot step runs', () => {
    expect(uploadStorageGate()).toBeNull()
  })

  it('and its question reaches this app once it has', async () => {
    await register()
    const gate = uploadStorageGate()
    expect(gate).not.toBeNull()
    expect(await gate?.check({ hostId: 'h1', bytes: 10 })).toEqual({
      status: 403,
      error: 'test',
      code: 'plan_limit_reached',
    })
    expect(mockCalls).toEqual([{ hostId: 'h1', bytes: 10 }])
  })
})
