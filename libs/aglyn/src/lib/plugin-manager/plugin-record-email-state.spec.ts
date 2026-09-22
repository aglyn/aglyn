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
  PLUGIN_RECORD_EMAIL_STATE,
  pluginRecordEmailStateWriter,
  registerPluginRecordEmailStateWriter,
  stampRecordEmailState,
  type PluginRecordEmailStateRequest,
  type PluginRecordEmailStateWriter,
} from './plugin-record-email-state'
import { hasPluginService, resetPluginServicesForTests } from './plugin-services'

function writer(label: string, fail = false): PluginRecordEmailStateWriter & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async stamp(request) {
      calls.push(`${label}:${request.email}:${request.state.status}`)
      if (fail) throw new Error('storage down')
      return { records: 2 }
    },
  }
}

const REQUEST: PluginRecordEmailStateRequest = {
  orgId: 'org-1',
  email: 'pat@example.com',
  state: { status: 'bounced', atMs: 1, source: 'sequence', detail: null },
}

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('the record email-state writer (AGL-3245)', () => {
  it('answers null while no plugin keeps records, and stamps nothing', async () => {
    expect(pluginRecordEmailStateWriter()).toBeNull()
    expect(hasPluginService(PLUGIN_RECORD_EMAIL_STATE)).toBe(false)
    expect(await stampRecordEmailState(REQUEST)).toBeNull()
  })

  it('stamps through the writer a record system registered, with its owner, for any caller', async () => {
    setRegisteringPluginId('records')
    const registered = writer('records')
    registerPluginRecordEmailStateWriter(registered)
    setRegisteringPluginId(undefined)

    expect(pluginRecordEmailStateWriter()?.pluginId).toBe('records')
    expect(await stampRecordEmailState(REQUEST)).toEqual({ records: 2 })
    expect(registered.calls).toEqual(['records:pat@example.com:bounced'])
  })

  it('never throws at the caller: a writer that fails is logged and answered as null', async () => {
    registerPluginRecordEmailStateWriter(writer('records', true), { pluginId: 'records' })
    expect(await stampRecordEmailState(REQUEST)).toBeNull()
  })

  it('is a slot: a second record system is refused naming both, and the first keeps serving', () => {
    registerPluginRecordEmailStateWriter(writer('records'), { pluginId: 'records' })
    expect(() => registerPluginRecordEmailStateWriter(writer('other'), { pluginId: 'other' })).toThrow(
      /records.*other|other.*records/,
    )
    expect(pluginRecordEmailStateWriter()?.pluginId).toBe('records')
  })

  it('refuses a writer with no owner', () => {
    expect(() => registerPluginRecordEmailStateWriter(writer('records'))).toThrow(/no owner/)
  })
})
