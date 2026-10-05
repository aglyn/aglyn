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
  PLUGIN_RECORD_ORIGIN,
  registerPluginRecordOriginWriter,
  stampRecordOrigin,
  type PluginRecordOriginRequest,
} from './plugin-record-origin'
import { hasPluginService, resetPluginServicesForTests } from './plugin-services'

/**
 * Where a person came from (AGL-3519): a door names its word, and whichever
 * plugin keeps the records stamps it — or nothing, when none does.
 */

const REQUEST: PluginRecordOriginRequest = {
  hostId: 'site-1',
  email: 'pat@example.com',
  origin: 'sequence',
}

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('the record-origin seam', () => {
  it('answers null when no plugin keeps records', async () => {
    expect(hasPluginService(PLUGIN_RECORD_ORIGIN)).toBe(false)
    await expect(stampRecordOrigin(REQUEST)).resolves.toBeNull()
  })

  it('hands the request to the one registered writer', async () => {
    const seen: PluginRecordOriginRequest[] = []
    registerPluginRecordOriginWriter(
      {
        async stamp(request) {
          seen.push(request)
          return { records: 1 }
        },
      },
      { pluginId: 'crm' },
    )
    await expect(stampRecordOrigin(REQUEST)).resolves.toEqual({ records: 1 })
    expect(seen).toEqual([REQUEST])
  })

  it('never throws: a writer that fails answers null', async () => {
    registerPluginRecordOriginWriter(
      {
        async stamp() {
          throw new Error('storage down')
        },
      },
      { pluginId: 'crm' },
    )
    await expect(stampRecordOrigin(REQUEST)).resolves.toBeNull()
  })

  it('keeps one record system: a second writer is refused', () => {
    const writer = { stamp: async () => ({ records: 0 }) }
    registerPluginRecordOriginWriter(writer, { pluginId: 'crm' })
    expect(() => registerPluginRecordOriginWriter(writer, { pluginId: 'other' })).toThrow()
  })
})
