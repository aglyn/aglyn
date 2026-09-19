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
  PLUGIN_RECORD_TIMELINE,
  pluginRecordTimelineWriter,
  registerPluginRecordTimelineWriter,
  type PluginRecordTimelineWriter,
} from './plugin-record-timeline'
import { hasPluginService, resetPluginServicesForTests } from './plugin-services'

function writer(label: string): PluginRecordTimelineWriter & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async logActivity(request) {
      calls.push(`${label}:activity:${request.email?.messageId ?? request.dedupeKey}`)
      return { ok: true, id: 'a1', created: true }
    },
    async createTask(request) {
      calls.push(`${label}:task:${request.dedupeKey}`)
      return { ok: true, id: 't1', created: true }
    },
  }
}

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('the record timeline writer (AGL-2981)', () => {
  it('answers null while no plugin keeps records', () => {
    expect(pluginRecordTimelineWriter()).toBeNull()
    expect(hasPluginService(PLUGIN_RECORD_TIMELINE)).toBe(false)
  })

  it('resolves the writer a record system registered, with its owner, for any caller', async () => {
    setRegisteringPluginId('records')
    const registered = writer('records')
    registerPluginRecordTimelineWriter(registered)
    setRegisteringPluginId(undefined)

    const resolved = pluginRecordTimelineWriter()
    expect(resolved?.pluginId).toBe('records')
    await resolved?.writer.createTask({
      orgId: 'org-1',
      hostId: 'host-1',
      link: { contactId: 'contact-1' },
      sourcePluginId: 'acme-mail',
      dedupeKey: 'reply-1',
      title: 'Reply from Pat',
      kind: 'email',
      dueAtMs: 1,
      assigneeUid: 'uid-rep',
      createdByUid: '',
    })
    expect(registered.calls).toEqual(['records:task:reply-1'])
  })

  it('is a slot: a second record system is refused naming both, and the first keeps serving', () => {
    registerPluginRecordTimelineWriter(writer('records'), { pluginId: 'records' })
    expect(() => registerPluginRecordTimelineWriter(writer('rival'), { pluginId: 'rival-records' })).toThrow(
      /already registered by "records"; refused "rival-records"/,
    )
    expect(pluginRecordTimelineWriter()?.pluginId).toBe('records')
  })

  it('lets the same plugin register again in place — a second surface, a hot reload', async () => {
    registerPluginRecordTimelineWriter(writer('first'), { pluginId: 'records' })
    const second = writer('second')
    registerPluginRecordTimelineWriter(second, { pluginId: 'records' })
    await pluginRecordTimelineWriter()?.writer.logActivity({
      orgId: 'org-1',
      hostId: 'host-1',
      link: { contactId: 'contact-1' },
      sourcePluginId: 'acme-mail',
      kind: 'email',
      atMs: 1,
      body: 'Hello',
      byUid: '',
      email: { direction: 'inbound', subject: 'Hi', from: 'pat@example.com', to: null, messageId: '<m1@example.com>' },
    })
    expect(second.calls).toEqual(['second:activity:<m1@example.com>'])
  })

  it('refuses a writer with no owner', () => {
    expect(() => registerPluginRecordTimelineWriter(writer('records'))).toThrow(/no owner/)
  })
})
