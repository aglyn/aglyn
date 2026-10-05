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
import { resetPluginServicesForTests } from './plugin-services'
import { registerPluginSendTally, tallySendUnsubscribe } from './plugin-send-tallies'

/**
 * Send tallies (AGL-3080): the door that saw a recipient leave tells the
 * plugins that send in bulk, and the one that owns the send counts it.
 */

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

it('stops at the sender that owns the send', async () => {
  const asked: string[] = []
  registerPluginSendTally(
    { unsubscribed: async ({ sendId }) => (asked.push(`a:${sendId}`), false) },
    { pluginId: 'a' },
  )
  registerPluginSendTally(
    { unsubscribed: async ({ sendId }) => (asked.push(`b:${sendId}`), sendId === 's1') },
    { pluginId: 'b' },
  )
  expect(await tallySendUnsubscribe({ hostId: 'h1', sendId: 's1' })).toBe(true)
  expect(await tallySendUnsubscribe({ hostId: 'h1', sendId: 's2' })).toBe(false)
  expect(asked).toEqual(['a:s1', 'b:s1', 'a:s2', 'b:s2'])
})

it('never throws: a sender that fails is passed over', async () => {
  registerPluginSendTally(
    {
      unsubscribed: async () => {
        throw new Error('down')
      },
    },
    { pluginId: 'a' },
  )
  registerPluginSendTally({ unsubscribed: async () => true }, { pluginId: 'b' })
  await expect(tallySendUnsubscribe({ hostId: 'h1', sendId: 's1' })).resolves.toBe(true)
})

it('counts nothing where nobody sends in bulk', async () => {
  await expect(tallySendUnsubscribe({ hostId: 'h1', sendId: 's1' })).resolves.toBe(false)
})
