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
  registerPluginDeclarationsRepair,
  resetPluginDeclarationsRepairForTests,
} from './plugin-declarations-repair'
import { readListingRevocation, registerPluginRevocationReader } from './plugin-revocations'
import { resetPluginServicesForTests } from './plugin-services'

/**
 * The kill switch, read through the plugin that keeps it (AGL-3080). A failed
 * read is the one answer that must not be quiet: it throws to the asker.
 */

beforeEach(() => {
  resetPluginServicesForTests()
  resetPluginDeclarationsRepairForTests()
  setRegisteringPluginId(undefined)
})

it('answers the listing’s revocation through its keeper', async () => {
  registerPluginRevocationReader(
    { revocation: async (id) => (id === 'l1' ? { versions: 'all', reason: 'pulled' } : null) },
    { pluginId: 'channel' },
  )
  expect(await readListingRevocation('l1')).toEqual({ versions: 'all', reason: 'pulled' })
  expect(await readListingRevocation('l2')).toBeNull()
  expect(await readListingRevocation('')).toBeNull()
})

it('throws what a failing reader throws, so the asker refuses', async () => {
  registerPluginRevocationReader(
    {
      revocation: async () => {
        throw new Error('unavailable')
      },
    },
    { pluginId: 'channel' },
  )
  await expect(readListingRevocation('l1')).rejects.toThrow('unavailable')
})

it('runs the boot step once before answering that nothing keeps revocations', async () => {
  const repair = jest.fn(async (): Promise<void> => undefined)
  registerPluginDeclarationsRepair(repair)
  expect(await readListingRevocation('l1')).toBeNull()
  expect(repair).toHaveBeenCalledTimes(1)

  registerPluginDeclarationsRepair(async () =>
    registerPluginRevocationReader({ revocation: async () => ({ versions: ['1'] }) }, { pluginId: 'channel' }),
  )
  expect(await readListingRevocation('l1')).toEqual({ versions: ['1'] })
})
