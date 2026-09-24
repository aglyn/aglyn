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
 * The email-streams slot (AGL-3305): core asks, one plugin answers, and the
 * caller's own write never depends on the answer.
 */

import {
  registerPluginEmailStreams,
  rejoinEmailStream,
} from './plugin-email-streams'
import { resetPluginServicesForTests } from './plugin-services'

const REQUEST = { hostId: 'host-1', email: 'person@example.com', topicId: 'product-updates' }

beforeEach(() => resetPluginServicesForTests())

describe('plugin-email-streams', () => {
  it('answers unavailable when no plugin keeps email preferences here', async () => {
    await expect(rejoinEmailStream(REQUEST)).resolves.toEqual({ status: 'unavailable' })
  })

  it('hands the request to the plugin and returns its answer', async () => {
    const rejoin = jest.fn(async () => ({
      status: 'rejoined' as const,
      releasedSuppression: true,
      keptLeft: 3,
    }))
    registerPluginEmailStreams({ rejoin }, { pluginId: 'email' })
    await expect(rejoinEmailStream(REQUEST)).resolves.toEqual({
      status: 'rejoined',
      releasedSuppression: true,
      keptLeft: 3,
    })
    expect(rejoin).toHaveBeenCalledWith(REQUEST)
  })

  it('turns a throw into failed, and logs the site — never the address', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerPluginEmailStreams(
      {
        rejoin: async () => {
          throw new Error('catalog unreadable')
        },
      },
      { pluginId: 'email' },
    )
    await expect(rejoinEmailStream(REQUEST)).resolves.toEqual({ status: 'failed' })
    const logged = error.mock.calls.map((call) => String(call[0])).join('\n')
    expect(logged).toContain('host-1')
    expect(logged).not.toContain('person@example.com')
    error.mockRestore()
  })

  it('is a slot: one owner, and a second plugin is refused naming both', () => {
    const impl = { rejoin: async () => ({ status: 'held' as const, reason: 'bounce' }) }
    expect(() => registerPluginEmailStreams(impl)).toThrow(/no owner/)
    registerPluginEmailStreams(impl, { pluginId: 'email' })
    // The same plugin again replaces its own entry.
    registerPluginEmailStreams(impl, { pluginId: 'email' })
    expect(() => registerPluginEmailStreams(impl, { pluginId: 'acme-mail' })).toThrow(
      /already registered by "email"; refused "acme-mail"/,
    )
  })
})
