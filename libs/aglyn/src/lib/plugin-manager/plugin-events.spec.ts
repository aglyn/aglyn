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
  listPluginEventHandlers,
  registerPluginEventHandler,
  resetPluginEventHandlersForTests,
  runPluginEventHandlers,
} from './plugin-events'

const ACTOR = { uid: 'u1', email: 'owner@example.test' }

beforeEach(() => {
  resetPluginEventHandlersForTests()
  setRegisteringPluginId(undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('plugin events', () => {
  it('runs every subscriber in order, attributed to its plugin', async () => {
    const seen: string[] = []
    setRegisteringPluginId('ai')
    registerPluginEventHandler('org.seatAddons.changed', (payload) => {
      seen.push(`ai:${payload.after?.aiAddon ?? 0}`)
    })
    setRegisteringPluginId(undefined)
    registerPluginEventHandler(
      'org.seatAddons.changed',
      () => {
        seen.push('backups')
      },
      { pluginId: 'acme-backups' },
    )
    const result = await runPluginEventHandlers('org.seatAddons.changed', {
      orgId: 'org-1',
      actor: ACTOR,
      before: {},
      after: { aiAddon: 1 },
    })
    expect(seen).toEqual(['ai:1', 'backups'])
    expect(result).toEqual({ handled: 2, failed: [] })
    expect(listPluginEventHandlers('org.seatAddons.changed')).toEqual(['ai', 'acme-backups'])
  })

  it('isolates a failing subscriber and names it', async () => {
    registerPluginEventHandler(
      'org.permissions.changed',
      () => {
        throw new Error('boom')
      },
      { pluginId: 'ai' },
    )
    const seen: string[] = []
    registerPluginEventHandler(
      'org.permissions.changed',
      (payload) => {
        seen.push(payload.permission)
      },
      { pluginId: 'acme-backups' },
    )
    const result = await runPluginEventHandlers('org.permissions.changed', {
      orgId: 'org-1',
      actor: ACTOR,
      subject: { type: 'member', id: 'u2' },
      permission: 'ai.generate',
      granted: false,
    })
    expect(seen).toEqual(['ai.generate'])
    expect(result).toEqual({ handled: 1, failed: ['ai'] })
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('ai failed on event org.permissions.changed'),
      expect.any(Error),
    )
  })

  it('a plugin re-subscribing replaces its handler; no owner is refused', async () => {
    const seen: string[] = []
    registerPluginEventHandler('org.seatAddons.changed', () => { seen.push('v1') }, { pluginId: 'ai' })
    registerPluginEventHandler('org.seatAddons.changed', () => { seen.push('v2') }, { pluginId: 'ai' })
    await runPluginEventHandlers('org.seatAddons.changed', {
      orgId: 'org-1',
      actor: ACTOR,
      before: null,
      after: null,
    })
    expect(seen).toEqual(['v2'])
    expect(() => registerPluginEventHandler('org.seatAddons.changed', () => undefined)).toThrow(
      /no owner/,
    )
    expect(await runPluginEventHandlers('org.permissions.changed', {
      orgId: 'org-1',
      actor: ACTOR,
      subject: { type: 'org' },
      permission: 'x',
      granted: true,
    })).toEqual({ handled: 0, failed: [] })
  })
})
